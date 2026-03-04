# LLM Bear — Design Specification

**Modeled after [TunnelBear](https://tunnelbear.com).** Same playful energy, same "anyone can use this" ethos, adapted for local AI instead of VPN.

---

## 1. The Metaphor

| TunnelBear (VPN) | LLM Bear (Local AI) |
|---|---|
| Bear **tunnels** to a country | Bear **tunnels** to an AI model |
| Yellow pipes on a world map | Yellow pipes connecting to model "islands" |
| On/Off toggle = VPN connected | On/Off toggle = Model running, API serving |
| Countries as destinations | Models as destinations (General, Code, Reasoning, Creative) |
| Bear digs through the earth | Bear digs through silicon / circuits |
| "Connected to Italy" | "Connected to Qwen 2.5 7B" |
| Server selection dropdown | Model selection dropdown |
| Green = protected | Green = running locally, your data is safe |

The bear is the guide. It makes AI feel friendly and safe. "The bear is running your AI" is way less scary than "Ollama is serving a quantized 7B parameter model on localhost."

---

## 2. Color Palette (TunnelBear-derived)

```
PRIMARY PALETTE
├── Sky Blue (background)     #E8F4F8   — Main app background, calm and open
├── Bear Brown (mascot)       #B8860B / #8B6914 — The bear itself
├── Pipe Yellow (accent)      #F5A623 / #EDBA3A — Tunnels, pipes, interactive elements
├── Grass Green (active)      #7BC67E / #4AA651 — "Running", "Connected", success states
├── Cloud White (cards)       #FFFFFF            — Card backgrounds, content areas
└── Earth Dark (text)         #2D3436 / #4A4A4A — Primary text, headings

SECONDARY PALETTE
├── Alert Orange              #FF8C42  — Upgrade available, attention needed
├── Danger Red                #E74C3C  — Errors, destructive actions (muted)
├── Deep Tunnel (dark pipe)   #5D4E37  — Inside-of-tunnel gradient
├── Water Blue (links)        #3498DB  — Interactive text, links
└── Snow White (disabled)     #BDC3C7  — Disabled states, inactive
```

**Key principle:** TunnelBear uses a **light, airy background** with **bold warm accents** (yellow/gold). Everything feels outdoorsy and friendly. No dark mode by default — this is sunshine and bears, not hacker terminals.

---

## 3. Typography

| Role | Font | Weight | Notes |
|------|------|--------|-------|
| **Display / Logo** | Fredoka One (or Baloo 2) | Bold | Rounded, playful, like TunnelBear's logo type |
| **Headings** | Nunito | 700, 800 | Rounded sans-serif, warm and readable |
| **Body** | Nunito | 400, 600 | Same family for cohesion |
| **Code / Mono** | JetBrains Mono | 400, 500 | For API keys, code snippets, model names |

TunnelBear uses rounded, soft typography throughout. No sharp geometric sans-serifs. Everything should feel huggable.

---

## 4. Layout — Main Views

### 4a. Main Screen (The "Map")

This is the hero view, equivalent to TunnelBear's world map.

```
┌──────────────────────────────────────────────────────┐
│  ● ● ●                                    LLM Bear  │
│                                                      │
│   ╭──────╮    Connected to                           │
│   │ ON ○─┤    Qwen 2.5 7B ▾                        │
│   ╰──────╯                                           │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │                                              │    │
│  │          🌿    🌲         🌿                 │    │
│  │      ╭────╮         ╭────╮      ╭────╮       │    │
│  │  🐻──┤ 💬 ├─────────┤ 🧠 │      │ 👨‍💻│       │    │
│  │  ▓▓  ╰────╯  ═══    ╰────╯      ╰────╯       │    │
│  │  General      ═══    Reasoning    Coding       │    │
│  │  ★ Active     ═══                              │    │
│  │               ═══    ╭────╮                    │    │
│  │       🌿      ═══    │ ✍️ │    🌲             │    │
│  │               ═══    ╰────╯                    │    │
│  │                      Creative                  │    │
│  │                                                │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│   API: ● Running on localhost:4000                   │
│   Key: sk-llmbear-a8f2k...  [Copy]                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**How it works:**
- The landscape shows model categories as "islands" or "locations" (like countries on TunnelBear's map)
- Each location has a yellow pipe/tunnel entrance
- The bear mascot sits at the currently active model
- When the user switches models, the bear **animates digging through a tunnel** to the new one
- Yellow pipe visually connects the bear's current position
- On/Off toggle in top-left (like TunnelBear)
- Dropdown next to it shows the current model name
- Bottom bar shows API status and key (quick copy)

### 4b. Model Hub (like TunnelBear's Server List)

```
┌──────────────────────────────────────────────────────┐
│  ← Back to Map                                       │
│                                                      │
│  Choose Your Model                                   │
│  "The bear recommends these for your machine"        │
│                                                      │
│  YOUR MACHINE: MacBook Pro M2, 16GB                  │
│  ★ Recommended: Qwen 2.5 7B                         │
│                                                      │
│  ┌───────────────────────────────────────────┐       │
│  │  💬 General Purpose                       │       │
│  │                                           │       │
│  │  ╭──────────────╮  ╭──────────────╮       │       │
│  │  │ 🐻 Qwen 2.5  │  │   Llama 3.2  │       │       │
│  │  │    7B         │  │    3B         │       │       │
│  │  │ ★ Best pick   │  │ Lighter      │       │       │
│  │  │ 4.7 GB        │  │ 2.0 GB       │       │       │
│  │  │ [■■■■■□□□□□]  │  │ [■■□□□□□□□□] │       │       │
│  │  │ [Connected]   │  │ [Get Model]  │       │       │
│  │  ╰──────────────╯  ╰──────────────╯       │       │
│  └───────────────────────────────────────────┘       │
│                                                      │
│  ┌───────────────────────────────────────────┐       │
│  │  🧠 Deep Reasoning                        │       │
│  │  ...                                      │       │
│  └───────────────────────────────────────────┘       │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Key principles:**
- Cards, not tables. Each model is a friendly card.
- **No jargon.** No "7B parameters" — say "4.7 GB download" and "★ Best pick for your machine"
- Progress bar shows download (looks like TunnelBear's data meter)
- Bear emoji/illustration on the recommended model
- Categories are collapsible sections, not filters

### 4c. Replace Your AI Service (The "Replace OpenAI" Wizard)

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│           🐻                                         │
│       "I'll replace                                  │
│        your paid AI!"                                │
│                                                      │
│  Step 1 of 3                                         │
│  ─────────────────────────────                       │
│  What are you replacing?                             │
│                                                      │
│  ╭──────────────────╮  ╭──────────────────╮          │
│  │   ○  ChatGPT /   │  │   ○  Claude /    │          │
│  │      OpenAI      │  │      Anthropic   │          │
│  ╰──────────────────╯  ╰──────────────────╯          │
│  ╭──────────────────╮  ╭──────────────────╮          │
│  │   ○  Gemini /    │  │   ○  Other       │          │
│  │      Google      │  │                  │          │
│  ╰──────────────────╯  ╰──────────────────╯          │
│                                                      │
│                          [ Next → ]                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Step 2: Model mapping with friendly dropdowns
Step 3: Copy your key + base URL, with pre-filled code snippets

The bear guides each step with a speech bubble / illustration.

### 4d. Chat (Test Your Model)

```
┌──────────────────────────────────────────────────────┐
│  Chat with 🐻 (powered by Qwen 2.5 7B)             │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │                                              │    │
│  │         🐻 "Ask me anything!                 │    │
│  │           Everything stays on your machine." │    │
│  │                                              │    │
│  │  ┌────────────────────────────────┐          │    │
│  │  │ You: What's the capital of     │          │    │
│  │  │      France?                   │          │    │
│  │  └────────────────────────────────┘          │    │
│  │                                              │    │
│  │  ┌────────────────────────────────┐          │    │
│  │  │ 🐻: The capital of France is  │          │    │
│  │  │     Paris! 🇫🇷                 │          │    │
│  │  └────────────────────────────────┘          │    │
│  │                                              │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────┐  [Send 🐾]    │
│  │ Type a message...               │                │
│  └──────────────────────────────────┘                │
│                                                      │
└──────────────────────────────────────────────────────┘
```

- Bear avatar for assistant messages
- User messages in yellow/gold bubbles (pipe-colored)
- Assistant messages in white/cloud bubbles
- Send button has a paw print 🐾
- Model name always visible in header

---

## 5. The Bear Mascot — States & Animations

The bear appears throughout the app in different states, just like TunnelBear uses its bear for different connection states:

| State | Bear Illustration | When |
|-------|-------------------|------|
| **Idle** | Bear sitting calmly, maybe reading a book | App open, no model running |
| **Connecting** | Bear digging into a tunnel (animated) | Model is loading / warming up |
| **Connected** | Bear popping out of a pipe, waving | Model is running, API is serving |
| **Downloading** | Bear carrying a heavy box / pushing a boulder | Model is downloading |
| **Download complete** | Bear flexing / celebrating | Download finished |
| **Thinking** | Bear with thought bubble, chin-scratching | Waiting for model response |
| **Typing** | Bear typing furiously on a laptop | Model is streaming a response |
| **Error** | Bear looking confused, scratching head | Something went wrong |
| **Upgrade available** | Bear pointing excitedly at something | New model available |
| **Password/Key** | Bear covering its eyes (like TunnelBear login!) | API key display/generation |
| **Sleeping** | Bear curled up, zzz | No model loaded, API idle |

These can start as static illustrations and become animated (CSS/Lottie) over time.

---

## 6. Micro-Interactions & Delight

Borrowing from TunnelBear's playful UX:

1. **Model switch animation** — When changing models, the bear "tunnels" through a yellow pipe from one model island to another. Short CSS animation (1-2 seconds). This is the signature moment.

2. **On/Off toggle** — Large, satisfying toggle switch. When turned on, pipe fills with golden color from left to right. Bear pops up.

3. **Download progress** — Bear pushes a progress bar like pushing a boulder uphill. Or: pipe fills up like a liquid meter.

4. **API key generation** — Bear covers its eyes (like TunnelBear's password bear), then peeks when the key is shown. "Copy" button with a paw icon.

5. **First chat message** — Bear waves and says "Rawr! I'm running 100% on your machine. No data leaves this cave. 🐾"

6. **Upgrade banner** — Bear pops up from bottom of screen holding a sign: "Hey! There's a newer, smarter model available!"

7. **Error states** — Bear looks apologetic. "Oops! The bear ran into a problem. [Try Again]"

8. **Empty states** — Bear sitting alone on a blank landscape. "No models installed yet. Let's get you set up! [Browse Models]"

---

## 7. Iconography

Custom bear-themed icons for navigation:

| Icon | Label | Description |
|------|-------|-------------|
| 🗺️ (illustrated) | **Map** | Main landscape view — bear + model tunnels |
| 🐻 (illustrated) | **Models** | Model hub / browse & download |
| 💬 (illustrated) | **Chat** | Test chat with current model |
| 🔑 (illustrated) | **API** | Replace OpenAI wizard + key management |
| ⚙️ (illustrated) | **Settings** | Preferences, aliases, about |

All icons should be hand-drawn/illustrated style matching the bear, not flat Material/SF Symbols.

---

## 8. Naming Conventions (User-Facing Language)

| Technical Term | LLM Bear Says |
|---|---|
| Model parameters (7B, 32B) | "Small", "Medium", "Large" (or just the download size) |
| Quantization | Never mentioned |
| VRAM / GPU | "Your machine can handle this ✓" or "This one's too big for your machine" |
| API endpoint | "Your AI address" |
| API key | "Your secret key" (with bear covering eyes) |
| localhost:4000 | "Your AI runs right here on this computer" |
| Model aliasing | "When apps ask for GPT-4, I'll answer instead" |
| Ollama | Never mentioned to user. It's under the hood. |
| Pull / download model | "Get this model" |
| Inference | "Thinking..." |
| Context window | Never mentioned |
| Token | Never mentioned to regular users |

---

## 9. Sound Design (Optional, P2)

TunnelBear has subtle sound effects. If we add them:
- **Model connected:** Soft "pop" (bear emerging from tunnel)
- **Download complete:** Happy chime
- **Toggle on:** Satisfying click
- **New message:** Soft notification

Always optional / mutable. Never annoying.

---

## 10. Responsive Behavior

| Size | Layout |
|------|--------|
| **Full window (>900px)** | Map landscape with sidebar nav |
| **Medium (600-900px)** | Map stacks above controls, sidebar becomes bottom tab bar |
| **Compact (<600px)** | Mini mode: just toggle + model dropdown + status (like TunnelBear minimized) |

The app should also support **system tray / menu bar** mode:
- Bear icon in menu bar (Mac) / system tray (Windows)
- Click → mini dropdown showing: current model, on/off toggle, API status, quick-copy key
- Like TunnelBear's minimized toolbar mode

---

## 11. Onboarding Flow

Directly inspired by TunnelBear's simple onboarding:

```
Screen 1: Welcome
  🐻 (big, friendly bear illustration)
  "Hi! I'm LLM Bear."
  "I run AI on your computer. No subscriptions. No data sharing."
  [Let's Go →]

Screen 2: Checking Your Machine
  🐻 (bear with magnifying glass, inspecting)
  "Let me check what you're working with..."
  ✓ MacBook Pro M2
  ✓ 16 GB RAM
  ✓ Apple GPU (Metal)
  "Nice machine! You can run some serious models."
  [Continue →]

Screen 3: Pick Your First Model
  🐻 (bear pointing at recommendation)
  "I recommend this one for you:"
  
  ╭──────────────────────────╮
  │  ★ Qwen 2.5 7B          │
  │  "Smart, fast, great     │
  │   for everyday use"      │
  │  4.7 GB download         │
  │  ~5 min on your internet │
  ╰──────────────────────────╯
  
  "Want something different? [Browse all models]"
  [Download & Start →]

Screen 4: Downloading
  🐻 (bear pushing progress boulder / digging tunnel)
  ████████░░░░░░░░  52%
  "Getting your model ready... almost there!"

Screen 5: You're Ready!
  🐻 (bear celebrating, arms up, popping out of pipe)
  "Rawr! Your AI is running!"
  "Everything is 100% local. Your data stays in this cave."
  
  [Start Chatting]  [Set Up API]
```

Total clicks from install to chatting: **4**
Total decisions required: **0** (we pick everything, they can change later)
