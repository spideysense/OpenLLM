// Compatibility adapter. Desktop and remote requests share the same execution engine.
const engine = require('./gateway-agent');
const { parseToolArgs } = require('./tool-args');
async function collect(args, validated) {
  let text = '';
  for await (const event of (validated ? engine.runValidated : engine.run)({ isOwner: true, ...args })) {
    if (event.type === 'content') text += event.text;
    if (event.type === 'error') throw new Error(event.text);
    args.onEvent?.(event);
  }
  return text;
}
module.exports = { runAgent: args => collect(args, false), runAgentValidated: args => collect(args, true),
  isEnabled: () => require('./tool-settings').getEnabledToolNames().length > 0, parseToolArgs };
