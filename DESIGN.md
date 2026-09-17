# Aspen: intelligence, right at home

Aspen is the household platform. HomeOS is its category, not another consumer brand. Butler, Secure and Energy are apps within Aspen. Phones, screens, future room pods and robots are clients of one household brain.

## Experience

- Lead with the home, its people and the next useful action.
- Make the model an implementation detail. Default to local inference; show clearly when it is not ready.
- Use familiar words, readable type, clear controls, generous spacing and native interaction patterns.
- Private is the default for notes and personal tasks. Sharing is an explicit choice.
- Keep a visible distinction between the sample home, actual local state and planned hardware.
- A request from a room device carries its assigned room and permissions. Speaker identity is unknown until separately authenticated.

## Visual system

Forest green #174d3c, near-white #f6f7f6, white cards, soft gray-green dividers and restrained amber/blue/olive app identities. System typography. Light, quiet surfaces with large headings and small amounts of product copy. No model selector on the home screen. Responsive navigation: left rail on desktop; bottom navigation on phones. Dialogs retain focus and keyboard behavior.

## Product architecture

1. Local household core: accounts, memory, task state, permissions and device API.
2. Local model runtime: answers use only already-authorized context.
3. Built-in apps: Butler tasks/reminders, Secure sensor view, Energy readings.
4. Integration adapters: explicitly approved Home Assistant devices first.
5. Clients: individual browser sessions and scoped API device identities.

The language model never determines authorization. It cannot issue arbitrary OS commands or control locks, alarms or robot movement. Home actions use typed API controls and device-state confirmation.
