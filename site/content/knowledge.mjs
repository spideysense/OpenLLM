// Aspen household product facts. Generated pages must distinguish the preview
// from the currently released local AI workspace and future hardware.
export const site = {
  name: 'Aspen', url: 'https://www.runonaspen.com', tagline: 'A home that remembers with you.',
  description: 'Aspen is the private operating system for your home. Its household developer preview brings family accounts, private and shared memory, local tasks, supported device readings and an authenticated device API together on your own computer.',
  appStore: 'https://apps.apple.com/app/id6775307566', github: 'https://github.com/spideysense/OpenLLM', appPath: '/home/?demo=1', updated: '2026-09-19',
};
export const faqGroups = [{ id: 'aspen-home', title: 'Aspen at home', items: [
  { q: 'What is Aspen?', a: 'Aspen is a private intelligence for family life: a local AI hub, flat-disc room pods, and one simple app. The product vision brings together last-seen belongings, family messages, reminders, connected services, and home controls. Hardware and these full experiences are in development; join the waitlist for launch news and early access.' },
  { q: 'What happens when I join the waitlist?', a: 'We save your email address so we can tell you about Aspen’s launch and early access. Joining is free and does not place an order. There is no launch date or hardware price announced yet. After a new signup, you get an invite link and a private link to check your position. Each new signup through your invite link gives you a seven-day head start in the queue. Duplicate signups do not count; removed signups lose their boost. Positions can change and do not guarantee early access. You can undo your signup on the confirmation screen or contact us to leave the list.' },
  { q: 'What can I use today?', a: 'Explore three interactive concept demos on the website, or install the Mac or Windows 0.9.0 household developer preview. The newer source build also turns pasted messages into locally drafted tasks for your review and approval. Email/calendar connections and automatic planning are still in development. The iPhone app remains the earlier AI workspace.' },
  { q: 'Does Aspen need its own box?', a: 'No. The household core can run on a supported Mac, Windows or Linux computer. A dedicated Aspen device is planned as an easier, always-on option. Computers still need enough available memory and processing power for the selected model.' },
  { q: 'What works without internet?', a: 'Local sign-in, saved memory, task management and the reminder scheduler run on the home computer. Model answers work offline once a compatible model is installed and running. Connected device access needs the home network. Email, bookings, remote access, downloads and cloud-only services need internet.' },
  { q: 'Will Aspen automatically find all my devices?', a: 'The preview discovers supported lights, climate and sensor devices through an existing local Home Assistant installation. You approve which devices Aspen can access. Automatic Wi-Fi provisioning, direct Matter commissioning and universal device discovery are not included yet.' },
  { q: 'Can my family keep things private?', a: 'Yes. Family members have separate accounts. Notes are private by default and can be explicitly shared with the household. Room devices receive shared context only and cannot choose another person’s identity to read their private memory.' },
  { q: 'Does Aspen use a fine-tuned household model?', a: 'The preview uses installed local models and authorized household context. It does not include a newly trained or fine-tuned model. Hardware-aware model selection is conservative; household-task evaluation and model specialization remain development work.' },
  { q: 'What about room speakers and robots?', a: 'The architecture includes an authenticated device API with revocable access, room context and limited permissions. Listening pods, local speech recognition, wake-word detection, robot clients and robot motion control are planned. Microphone access is disabled in this preview.' },
  { q: 'Is this the finished plug-and-play product?', a: 'Not yet. This is the household developer preview. Automatic network onboarding, password recovery, secure remote access, audited app isolation and production hardware validation are required before a consumer release.' },
]}];
const workspaceDocs = [
  {
    id: 'overview',
    title: 'Overview',
    summary: 'What Aspen is and how it runs AI privately on your own machine.',
    blocks: [
      ['p', 'Aspen is private AI that runs entirely on your own hardware. Instead of sending your prompts to a company\'s servers, Aspen runs an open large language model locally and gives you a clean app to chat with it. Nothing leaves your device.'],
      ['p', 'Aspen has three parts that work together: the model (an open LLM such as Llama, Qwen, DeepSeek, or Mistral that runs on your machine), a local gateway (an OpenAI-compatible server on your computer that handles requests, tools, and memory), and the apps (desktop for Mac and Windows, plus a free iPhone app that connects back to your own machine).'],
      ['note', 'There is no cloud and no account. Core chat and coding work fully offline once a model is downloaded.'],
    ],
  },
  {
    id: 'install',
    title: 'Install',
    summary: 'Get Aspen running on Mac, Windows, or iPhone in a couple of minutes.',
    blocks: [
      ['h', 'Mac and Windows'],
      ['p', 'Download the free app from runonaspen.com and open it. There is no terminal or configuration required. On first launch, Aspen detects your hardware and recommends a model to download.'],
      ['p', 'Prefer the command line? One command installs everything and adds Aspen to your apps menu:'],
      ['code', 'bash', 'curl -fsSL https://runonaspen.com/install.sh | sh'],
      ['note', 'Windows may show a "Windows protected your PC" warning on first run because Aspen is from an independent developer. Click More info, then Run anyway. It is safe.'],
      ['h', 'iPhone'],
      ['p', 'Install "Aspen Local AI" free from the App Store. The phone app connects to the AI running on your own computer, so you can use your private models from anywhere.'],
    ],
  },
  {
    id: 'quickstart',
    title: 'Quickstart',
    summary: 'Open Aspen, pick a model, and ask your first question.',
    blocks: [
      ['ol', [
        'Open Aspen. It detects your hardware and suggests a model that fits.',
        'Let the recommended model download (one time). Smaller models download and load faster.',
        'Type a question in the chat box and press enter. The reply streams back, generated on your machine.',
        'Try voice, attach an image, or ask it to write and run code — all locally.',
      ]],
      ['p', 'That is the whole setup. Everything after this is optional configuration for power users and developers.'],
    ],
  },
  {
    id: 'models',
    title: 'Choosing a model',
    summary: 'How to pick the right local model for your machine.',
    blocks: [
      ['p', 'Aspen runs the latest open models and shows a library you can browse in Settings. Each model lists its size and the memory it needs, and Aspen flags any that may be too large for your machine.'],
      ['h', 'Rough hardware guide'],
      ['ul', [
        '8GB RAM: small models around 3B parameters.',
        '16GB RAM: 7–8B models, a great all-round sweet spot.',
        '32GB RAM: 13–14B models.',
        '64GB+ RAM: 30B+ models for the strongest local quality.',
      ]],
      ['p', 'For most people a mid-sized Qwen or Llama model is the best default for chat, tool use, and coding. Aspen can update to a newer, better model automatically as the open ecosystem improves.'],
      ['note', 'Quantized models use less memory and run faster with little quality loss — Aspen uses sensible quantized versions by default.'],
    ],
  },
  {
    id: 'chat',
    title: 'Chat & artifacts',
    summary: 'Conversational AI with live code and HTML previews.',
    blocks: [
      ['p', 'The chat works like any modern AI assistant: ask questions, brainstorm, write and edit text, or get coding help. Responses stream in real time, generated locally.'],
      ['p', 'When you ask Aspen to build something on the web — a page, a small app, a visualization — it renders a live artifact with a preview panel right in the chat, so you can see and run the result immediately.'],
    ],
  },
  {
    id: 'voice',
    title: 'Voice',
    summary: 'Hands-free voice conversations, processed on-device.',
    blocks: [
      ['p', 'Aspen includes a hands-free voice mode with a natural neural voice. Speak your question and hear the answer back, with speech handled on your machine.'],
    ],
  },
  {
    id: 'vision',
    title: 'Vision',
    summary: 'Analyze images and screenshots with a local vision model.',
    blocks: [
      ['p', 'Attach a photo or screenshot and Aspen reads it with a local vision model. Ask it to describe an image, critique a design, extract text, or explain a chart. The image never leaves your machine.'],
    ],
  },
  {
    id: 'tools',
    title: 'Tools',
    summary: 'Web search, URL fetch, shell commands, and more — all run on your machine.',
    blocks: [
      ['p', 'Tools let your local model do things beyond chat. Every tool runs on your own computer and uses your own network; nothing is routed through Aspen\'s servers. Toggle each one in Settings.'],
      ['ul', [
        'Web search — current information from the live web, with the source cited. Runs from your machine and your IP.',
        'Read web page — fetch and read the text of a specific URL.',
        'Run commands — execute shell commands to clone repos, read and write files, and run scripts (works best with larger models).',
        'Download files — fetch a file to work with locally.',
        'Calculator and date/time — quick deterministic helpers.',
        'Git — clone, status, and commit/push helpers.',
      ]],
      ['note', 'For real-time questions (weather, news, prices), enable Web Search so the model answers from live results instead of memory.'],
    ],
  },
  {
    id: 'memory',
    title: 'Memory (World Model)',
    summary: 'A private, local memory that personalizes answers.',
    blocks: [
      ['p', 'Aspen can build a "World Model" — a set of facts about you, learned from your conversations, that makes its answers more personal and context-aware. It is stored as a plain file on your own computer.'],
      ['p', 'After each conversation, your local model quietly extracts useful facts (name, job, preferences, projects) and prepends them to new chats so the AI remembers who you are. You can view, edit, or delete any fact at any time.'],
      ['note', '100% local — these facts never leave your machine and are never sent to any server.'],
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    summary: 'Why Aspen is private by design.',
    blocks: [
      ['p', 'Privacy is the whole point. The model runs on your hardware, there is no server in the middle, and your conversations are never transmitted or used for training.'],
      ['p', 'The only time anything touches the network is when you explicitly use an online tool such as web search — and that request goes out from your own machine and IP, not through Aspen. You stay in control.'],
    ],
  },
  {
    id: 'api',
    title: 'Developer API',
    summary: 'Drop-in, OpenAI-compatible API for your own apps.',
    blocks: [
      ['p', 'Aspen runs a local gateway that speaks the OpenAI API format. Point any OpenAI-style client at your Aspen endpoint and it works unchanged — your tools now run against your own private AI.'],
      ['h', 'Endpoints'],
      ['ul', [
        'Same machine: http://localhost:4000/v1',
        'From anywhere: a private, secure HTTPS URL Aspen can generate for you, so your phone and other apps reach your machine securely.',
      ]],
      ['h', 'Python (OpenAI SDK)'],
      ['code', 'python', 'from openai import OpenAI\n\nclient = OpenAI(\n    base_url="http://localhost:4000/v1",\n    api_key="YOUR-ASPEN-KEY",\n)\n\nresp = client.chat.completions.create(\n    model="local",   # the model name shown in the Aspen app\n    messages=[{"role": "user", "content": "Hello from my own machine"}],\n)\nprint(resp.choices[0].message.content)'],
      ['h', 'JavaScript (fetch)'],
      ['code', 'javascript', 'const r = await fetch("http://localhost:4000/v1/chat/completions", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "Authorization": "Bearer YOUR-ASPEN-KEY",\n  },\n  body: JSON.stringify({\n    model: "local",\n    messages: [{ role: "user", content: "Hello" }],\n  }),\n});\nconst data = await r.json();\nconsole.log(data.choices[0].message.content);'],
      ['h', 'API key tiers'],
      ['ul', [
        'Owner — full access including computer use and shared memory. Only for devices that are you.',
        'Family / member — its own private memory plus safe tools; no computer use.',
        'Anonymous guest — chat and safe tools only, ephemeral, safe to share widely.',
      ]],
      ['p', 'Aspen works with the OpenAI and Anthropic SDKs, LangChain, Cursor, Continue.dev, n8n, Zapier, and similar tools — anything that accepts a custom base URL and key.'],
    ],
  },
  {
    id: 'connectors',
    title: 'Connectors (MCP)',
    summary: 'Connect tools like GitHub through open MCP connectors.',
    blocks: [
      ['p', 'Aspen supports connectors built on the open Model Context Protocol (MCP), letting your local AI work with services like GitHub. Access tokens are encrypted and stay on your device.'],
    ],
  },
  {
    id: 'device',
    title: 'The Aspen device',
    summary: 'Optional always-on hardware for the largest models.',
    blocks: [
      ['p', 'The Aspen device is an optional, dedicated machine for running the largest models around the clock without using your own computer. You never need it to use Aspen — the free app runs well on a modern Mac or PC.'],
      ['ul', [
        'About 1 petaflop of AI performance',
        '128GB unified memory',
        'Runs models up to roughly 200B parameters',
        'Silent and always on',
        'About 5.9" x 5.9" x 2"',
      ]],
      ['p', 'It is available by preorder with a $1 deposit.'],
    ],
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    summary: 'Common issues and quick fixes.',
    blocks: [
      ['h', 'Windows "protected your PC" warning'],
      ['p', 'Normal and safe for a new app from an independent developer. Click More info, then Run anyway. If the download was blocked, right-click the file, choose Properties, check Unblock, then run it.'],
      ['h', 'A model is slow or crashes'],
      ['p', 'The model is probably large relative to your memory. Pick a smaller or more quantized model, close memory-heavy apps, or use a machine with more RAM. Aspen flags models that may be too big for your hardware.'],
      ['h', 'It says it cannot get current information'],
      ['p', 'Enable the Web Search tool in Settings so the model can answer real-time questions from the live web with cited sources.'],
    ],
  },
];

export const docs = [
  { id: 'home', title: 'Set up the household preview', summary: 'Run the new Aspen household core locally.', blocks: [
    ['p', 'Mac and Windows 0.9.0 installers include the household developer preview. The newer source build adds message-to-plan drafting: paste a message, let a running local model suggest tasks, edit them, and explicitly approve saving to your encrypted household vault. Tasks are private by default. Gmail/calendar automation is not yet available. Website family moments use fictional sample data and make no real changes.'],
    ['ol', ['Use Node.js 20 or newer on a supported Mac, Windows or Linux computer.', 'From the preview source folder, run npm run home.', 'Open the private setup link printed on that computer. Create a home and an owner account.', 'Add rooms, invite family, and use Butler for local tasks and reminders.', 'For local model answers, run Ollama. In Settings, Prepare can download a recommended model. Aspen chooses a conservative memory fit from installed general-purpose models.']],
    ['code', 'bash', 'npm run home'],
    ['note', 'The server listens only on 127.0.0.1 by default. Connecting another device requires an HTTPS configuration and a reachable, explicitly configured origin. Do not expose the service directly to the public internet.'],
    ['p', 'For the packaged desktop preview, build the branch using the existing platform build scripts. Native signing and hardware validation are still required. ASPEN_WORKSPACE=1 opens the existing local AI workspace.'],
  ]},
  { id: 'household-apps', title: 'Household apps', summary: 'Butler, Secure and Energy in the preview.', blocks: [
    ['ul', ['Butler: local tasks, due dates, completion tracking and reminders. The existing online Butler remains a separate service for bookings, email, phone calls and browser work.', 'Secure: last synchronized readings from approved Home Assistant door and motion sensors. It is not a monitored alarm service.', 'Energy: approved Home Assistant energy and climate readings. Automatic optimization and financial savings estimates are not implemented.']],
    ['p', 'Only the household owner can add or remove built-in apps and approve integrations. Third-party executable plugins and their sandboxing are not part of this release.'],
  ]},
  { id: 'privacy', title: 'Household privacy and security', summary: 'Local state, individual accounts and explicit device permissions.', blocks: [
    ['ul', ['The household vault is encrypted using AES-256-GCM. Desktop uses the operating-system key store when available. Headless mode uses a restricted local key file or an externally supplied key; protect the computer with disk encryption.', 'Passwords use salted scrypt. Sessions use HttpOnly, SameSite=Strict cookies, with Secure on HTTPS. Session tokens expire and sign-out revokes them.', 'Private memory is filtered by authenticated member before a model sees context. Devices receive only household-shared memory.', 'Pairing codes expire after five minutes and can be redeemed once. Client tokens are stored as hashes and can be revoked.', 'The device API validates room access and action permissions independently of the model. Light control is allowlisted. Lock, alarm, robot motion and arbitrary shell actions are excluded.', 'The household server has no cloud inference fallback, analytics, microphone capture or automatic internet tunnel. Explicit integrations and local model downloads have separate network needs.']],
    ['note', 'This is an implemented security foundation, not a completed independent security audit. Recovery, encrypted backups, signed updates, hardware commissioning and a full production threat review remain release gates.'],
  ]},
  { id: 'devices', title: 'Connect household devices', summary: 'Approve devices discovered through local Home Assistant.', blocks: [
    ['ol', ['Open Settings, then Connected home.', 'Enter the local Home Assistant address and a long-lived access token.', 'Select the supported devices Aspen may access and assign their rooms.', 'Refresh readings from Settings or the Secure and Energy apps.']],
    ['p', 'The integration currently supports private IPv4 addresses and local hostnames resolving only to private IPv4 addresses. Credentials are never sent to the language model. Automatic mDNS provisioning and direct Matter pairing remain future work.'],
  ]},
  { id: 'device-api', title: 'Device API for phones, pods and robots', summary: 'One household brain with authenticated, scoped clients.', blocks: [
    ['p', 'The household API is rooted at /v1/home. An owner creates a short-lived pairing code in Settings. A client exchanges it at POST /pair, stores the returned Bearer token securely and uses only the granted scopes. See docs/HOME_API.md in the source for request schemas.'],
    ['ul', ['home:read — household-shared state; excludes private memory.', 'chat:ask — ask the local model with authorized context.', 'tasks:write — create and complete shared tasks.', 'devices:control — operate approved lights within the client’s assigned room.']],
    ['p', 'Room pods and robots must have a room. A shared device cannot supply a member ID to impersonate someone. Revoking the client disables its token immediately. Voice capture and robotics execution adapters are not included.'],
  ]},
  ...workspaceDocs.filter(d => !['privacy'].includes(d.id)).map(d => ({...d, title: 'AI workspace: ' + d.title, blocks: [['note', 'This section describes the existing Aspen AI workspace. It is separate from the new household preview.'], ...d.blocks]})),
];
