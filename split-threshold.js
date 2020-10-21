let p = n => ('' + n).padStart(2, '0')
function now() {
  let d = new Date()
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(
    d.getSeconds()
  )}`
}

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

  let timers = {}

  function Node(config) {
    RED.nodes.createNode(this, config)

    let node = this

    if (config.startCompare[0] == config.stopCompare[0] && /<|>/.test(config.startCompare[0])) {
      node.warn(
        `Both thresholds include '${config.startCompare[0]}'. This may lead to unintended consequences.`
      )
    }
    let timeout = MULTIPLIERS[config.durationUnit] * config.duration

    let outputMsg = {}
    let outputPayload = RED.util.evaluateNodeProperty(config.payload, config.payloadType, node)
    RED.util.setMessageProperty(outputMsg, 'payload', outputPayload)

    node.on('input', function (msg) {
      let timerName =
        config.handling == 'all' ? 'default' : RED.util.getMessageProperty(msg, config.each)

      if (timerName === undefined)
        return node.warn(`Input message missing msg.${config.each}, which is required for timer`)

      let a = RED.util.getObjectProperty(msg, config.property)
      let b = RED.util.evaluateNodeProperty(config.startValue, 'num', node, msg)
      let c = RED.util.evaluateNodeProperty(config.stopValue, 'num', node, msg)

      if (TESTS[config.startCompare](a, b) && !timers[timerName]) {
        timers[timerName] = setTimeout(() => {
          timers[timerName] = null
          RED.util.setMessageProperty(outputMsg, config.each, timerName)
          node.send(outputMsg)
          updateStatus()
        }, timeout)
        updateStatus()
      }

      if (TESTS[config.stopCompare](a, c) && timers[timerName]) {
        clearTimeout(timers[timerName])
        timers[timerName] = null
        updateStatus()
      }
    })

    let statusTimer

    function updateStatus() {
      let active = Object.entries(timers)
        .map(([name, timer]) => [name, timer && timeRemaining(timer)])
        .filter(([name, secs]) => secs > 0)

      if (!active.length) return node.status({ text: '' })
      let text = active.map(([name, secs]) => `${name}:${secs}s`).join(` | `)
      node.status({ text })
      clearTimeout(statusTimer)
      statusTimer = setTimeout(updateStatus, timeout / 10)
    }
    function timeRemaining(t) {
      return Math.ceil((t._idleStart + t._idleTimeout) / 1000 - global.process.uptime())
    }
  }
  RED.nodes.registerType('Split Threshold', Node)
}
