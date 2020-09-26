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

  function Node(config) {
    RED.nodes.createNode(this, config)

    let node = this

    if (config.startCompare[0] == config.stopCompare[0] && /<|>/.test(config.startCompare[0])) {
      node.warn(
        `Both thresholds include '${config.startCompare[0]}'. This may lead to unintended consequences.`
      )
    }

    let timer
    let timeout = MULTIPLIERS[config.durationUnit] * config.duration

    let outputMsg = {}
    let outputPayload = RED.util.evaluateNodeProperty(config.payload, config.payloadType, node)
    RED.util.setMessageProperty(outputMsg, 'payload', outputPayload)

    node.on('input', function (msg) {
      let a = RED.util.getObjectProperty(msg, config.property)
      let b = RED.util.evaluateNodeProperty(config.startValue, 'num', node, msg)
      let c = RED.util.evaluateNodeProperty(config.stopValue, 'num', node, msg)

      if (TESTS[config.startCompare](a, b) && !timer) {
        timer = setTimeout(() => {
          timer = null
          node.send(outputMsg)
          node.status({
            text: `Timer completed at ${now()}`
          })
        }, timeout)
        node.status({
          text: `Timer running for ${config.duration}${
            config.durationUnit == 'milliseconds' ? 'ms' : config.durationUnit[0]
          }`
        })
      }

      if (TESTS[config.stopCompare](a, c) && timer) {
        clearTimeout(timer)
        timer = null
        node.status({
          text: 'Timer stopped'
        })
      }
    })
  }
  RED.nodes.registerType('Split Threshold', Node)
}
