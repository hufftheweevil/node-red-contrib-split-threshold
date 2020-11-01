module.exports = function (RED) {
  const TESTS = {
    '==': (a, b) => a == b,
    '!=': (a, b) => a != b,
    '<': (a, b) => a < b,
    '<=': (a, b) => a <= b,
    '>': (a, b) => a > b,
    '>=': (a, b) => a >= b
  }
  const MULTIPLIERS = {
    milliseconds: 1,
    seconds: 1000,
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000
  }

  let timerCollections = {}

  // One collection per node
  class TimerCollection {
    constructor(node) {
      this.timers = {}
      this.node = node
      timerCollections[node.id] = this
      // NOTE: this.config MUST be set after initialized
    }
    get(timerName) {
      if (!this.timers[timerName]) this.timers[timerName] = new Timer(timerName, this)
      return this.timers[timerName]
    }
    destroy() {
      for (let name in this.timers) {
        this.timers[name].stop(true)
        delete this.timers[name]
      }
      this.updateStatus()
      delete timerCollections[this.node.id]
    }
    updateStatus() {
      clearTimeout(this.statusTimer)

      let text =
        this.config.handling == 'all'
          ? this.timers['default'] && this.timers['default'].timeRemaining
          : Object.values(this.timers)
              .filter(timer => timer.timeRemaining)
              .map(timer => `${timer.name}:${timer.timeRemaining}`)
              .join(` | `)

      this.node.status({ text })

      // If there is still a status (i.e. active timers), call
      // self after 1/10th of config timeout (no less than 5 secs)
      if (text)
        this.statusTimer = setTimeout(
          this.updateStatus.bind(this),
          Math.max(this.timeout / 10, 5000)
        )
    }
    get timeout() {
      return MULTIPLIERS[this.config.durationUnit] * this.config.duration
    }
  }

  // One timer per topic (or other `each` field); Or one timer for `default` in all-message mode
  class Timer {
    constructor(name, collection) {
      this.name = name
      this.collection = collection
    }
    get node() {
      return this.collection.node
    }
    get config() {
      return this.collection.config
    }
    start() {
      this.timer = setTimeout(this.trigger.bind(this), this.collection.timeout)
      this.collection.updateStatus()
    }
    stop(silent) {
      clearTimeout(this.timer)
      this.timer = null
      if (!silent) this.collection.updateStatus()
    }
    get timeRemaining() {
      if (!this.timer) return ''
      let secs = (this.timer._idleStart + this.timer._idleTimeout) / 1000 - global.process.uptime()
      return Math.ceil(secs) + 's'
    }
    update(a, b, c) {
      this.value = a

      // Determine if timer should start
      // Note if the latch is already engaged but the timer isnt
      // running, we only start the timer if in aggressiveMode. Otherwise,
      // the value must fail the start test first, which will release the
      // the latch, before the timer can be started again.
      let test = TESTS[this.config.startCompare](a, b)
      if (test && !this.timer && (!this.latch || this.config.aggressiveMode)) this.start()
      this.latch = test

      // Determine if timer should stop
      if (TESTS[this.config.stopCompare](a, c) && this.timer) this.stop()
    }
    trigger() {
      this.timer = null
      let output = {
        payload: RED.util.evaluateNodeProperty(
          this.config.payload,
          this.config.payloadType,
          this.node
        )
      }
      if (this.config.each) {
        try {
          RED.util.setMessageProperty(output, this.config.each, this.name)
        } catch (e) {
          this.node.error(`Unable to set ${this.config.each} to ${this.name}: ${e}`)
        }
      }
      this.node.send(output)
      this.collection.updateStatus()
    }
  }

  function Node(config) {
    RED.nodes.createNode(this, config)

    let node = this

    // Reference previous collection, or start new
    let timerCollection = timerCollections[node.id] || new TimerCollection(node)

    // Update node ref, and config (in case it changed)
    timerCollection.node = node
    timerCollection.config = config

    // Validate conditions
    let start0 = config.startCompare[0]
    let stop0 = config.stopCompare[0]
    if (/<|>/.test(start0) && /<|>/.test(stop0)) {
      if (start0 == stop0)
        node.warn(`Both thresholds include '${start0}'. This may lead to unintended consequences.`)
      else if (TESTS[stop0](config.startValue, config.stopValue))
        node.warn(
          `Check comparison signs. Current configuration may lead to unintended consequences.`
        )
    }

    // Update status (for persist mode)
    timerCollection.updateStatus()

    // Wait for incoming messages
    node.on('input', function (msg) {
      // Get timer name
      let timerName =
        config.handling == 'all' ? 'default' : RED.util.getMessageProperty(msg, config.each)
      if (timerName === undefined)
        return node.warn(`Input message missing msg.${config.each}, which is required for timer`)

      // Get all values needed for tests
      let a = RED.util.getObjectProperty(msg, config.property)
      let b = RED.util.evaluateNodeProperty(config.startValue, 'num', node, msg)
      let c = RED.util.evaluateNodeProperty(config.stopValue, 'num', node, msg)

      // Send values to timer for testing
      timerCollection.get(timerName).update(a, b, c)
    })

    // Destroy if not in persist mode
    node.on('close', () => {
      if (!config.persistMode) timerCollection.destroy()
    })
  }
  RED.nodes.registerType('Split Threshold', Node)
}
