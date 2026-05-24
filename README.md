# 🎯 Desafio 21 Dias — App de Acompanhamento

> Full-stack web application for managing and tracking a **21-day transformation challenge**. Built for real users, live in production — featuring daily check-ins, audio player, EPUB reader, automation pipelines, and payment integrations.

**🌐 Live at:** [wpktavares.com.br/app](https://wpktavares.com.br/app)

---

## ✨ Features

- **🔐 Authentication** — Secure login system with session management
- **✅ Daily Check-in** — Progress registration with confetti celebration 🎉
- **4 Daily Pillars:**
  - 🧘 **Meditation** — Integrated countdown timer
  - 📖 **Reading** — Built-in EPUB reader (epub.js)
  - 💪 **Exercise** — Activity tracking
  - 🎧 **Audio** — Full-featured player with speed control, cover art, progress tracking
- **📊 Progress History** — Visual timeline of all 21 days
- **🏆 Completion System** — Special celebration modal + confetti when finishing all 21 days
- **🔔 WhatsApp Notifications** — Automated via GPT Maker integration
- **👑 Admin Panel** — Student management and metrics dashboard
- **💳 Payment Webhooks** — Cakto integration for automatic student enrollment
- **📈 Meta Ads Tracking** — Conversions API for ad performance
- **🤖 QA Agent** — Automated testing with Playwright + Python

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend / API** | Google Apps Script (GAS) |
| **Frontend** | HTML5 · CSS3 · JavaScript (Vanilla) |
| **Hosting** | Firebase Hosting |
| **Database** | Google Sheets |
| **GAS Deploy** | clasp CLI |
| **Notifications** | GPT Maker (WhatsApp API) |
| **Payments** | Cakto (Webhook) |
| **Ads Tracking** | Meta Conversions API |
| **QA Testing** | Python · Playwright |

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────┐
│              Firebase Hosting  (wpktavares.com.br)           │
│                                                              │
│   ┌─────────────────┐      ┌───────────────────────────┐    │
│   │  Landing Page   │      │     App SPA (app.html)    │    │
│   │  (index.html)   │      │   Vanilla JS · CSS3       │    │
│   └─────────────────┘      └─────────────┬─────────────┘    │
└────────────────────────────────────────── │ ─────────────────┘
                                            │  fetch() REST calls
                                 ┌──────────▼──────────────┐
                                 │    Google Apps Script   │
                                 │    (Backend / API)      │
                                 │  ┌────────────────────┐ │
                                 │  │   Google Sheets    │ │
                                 │  │    (Database)      │ │
                                 │  └────────────────────┘ │
                                 └─────────────────────────┘
                                            │
                          ┌─────────────────┼──────────────────┐
                          │                 │                  │
                   ┌──────▼──────┐  ┌───────▼──────┐  ┌───────▼──────┐
                   │  GPT Maker  │  │    Cakto     │  │  Meta Ads   │
                   │  WhatsApp   │  │   Webhooks   │  │    API      │
                   └─────────────┘  └──────────────┘  └─────────────┘
```

---

## 📁 Project Structure

```
app-21dias/
│
├── 📄 aluno.html                   # Student app (GAS server-side version)
├── 📄 login.html                   # Login page
├── 📄 index.html                   # GAS entry point
│
├── 📄 aluno_routes.gs              # Student data routes & API responses
├── 📄 auth.gs                      # Authentication logic
├── 📄 code.gs                      # Backend core & routing
├── 📄 modules.gs                   # Shared modules
├── 📄 helpers.gs                   # Utility functions
├── 📄 automation.gs                # Email & automation flows
├── 📄 automation_additions.gs      # Extended automation rules
├── 📄 notifications.gs             # WhatsApp notification system
├── 📄 webhook_cakto.gs             # Cakto payment webhook handler
├── 📄 metaApi.gs                   # Meta Conversions API integration
├── 📄 leads.gs / leadsSync.gs      # Lead management & CRM sync
├── 📄 eventos.gs                   # Event tracking
├── 📄 workspace_audio.gs           # Audio workspace helpers
├── 📄 setup.gs                     # Initial setup & configuration
├── 📄 reabertura.gs                # Re-enrollment flow
│
├── 📄 appsscript.json              # GAS manifest & OAuth scopes
├── 📄 .claspignore                 # clasp upload filter
│
├── 📁 site/wpktavares-site/        # Firebase Hosting project
│   ├── 📄 firebase.json
│   ├── 📄 .firebaserc
│   ├── 📄 deploy.bat               # Firebase deploy script
│   └── 📁 public/
│       ├── 📄 index.html           # Landing page
│       ├── 📄 404.html
│       └── 📁 app/
│           ├── 📄 app.html         # 🚀 Production SPA (main app)
│           └── 📄 index.html       # Firebase login page
│
├── 📁 qa_agent/                    # Automated QA with Playwright
│   ├── 📄 run_qa.py                # Test runner
│   ├── 📄 config.json              # QA configuration
│   └── 📁 src/
│       ├── browser.py · logger.py · evidence.py
│       ├── ai_prompt_builder.py · report_builder.py
│       └── utils.py
│
└── 📄 deploy-all.bat               # 🚀 One-command full deploy
```

---

## 🚀 One-Command Deploy

Every feature ships to all three platforms with a single command:

```bash
deploy-all.bat
```

**What it does, in order:**
1. `clasp push --force` + `clasp deploy` → **Google Apps Script** (backend)
2. `firebase deploy --only hosting` → **Firebase Hosting** (frontend)
3. `git add . && git commit && git push` → **GitHub** (version control)

---

## ⚙️ Local Setup

### Prerequisites

```bash
npm install -g @google/clasp     # Google Apps Script CLI
npm install -g firebase-tools    # Firebase CLI
```

### Clone & Configure

```bash
git clone https://github.com/davi-ramon/desafio-21-dias.git
cd desafio-21-dias

# Authenticate with Google (GAS)
clasp login

# Authenticate with Firebase
firebase login

# Create your own .clasp.json pointing to your GAS project
echo '{"scriptId":"YOUR_SCRIPT_ID","rootDir":"."}' > .clasp.json
```

### QA Agent (optional)

```bash
cd qa_agent
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python run_qa.py
```

---

## 👨‍💻 Author

**Deyvid Ramon** — Full Stack Developer  
📧 ads.deyvid@gmail.com  
🐙 [github.com/davi-ramon](https://github.com/davi-ramon)

---

> Built for **Wagner Tavares** — High-performance mentor and creator of the 21-day challenge methodology.  
> [wpktavares.com.br](https://wpktavares.com.br)
