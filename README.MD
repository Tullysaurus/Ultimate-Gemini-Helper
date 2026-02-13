# Universal Educational Tool Suite (UETS)

A comprehensive, full-stack solution designed to provide AI-powered assistance and automated optimizations for online educational platforms. This project bridges a Python-based FastAPI backend with powerful client-side Tampermonkey scripts to deliver real-time analysis and automation.

## 🚀 Features

### Core Backend (Python/FastAPI)

* **Gemini AI Integration**: Mirrors the Gemini API to provide intelligent question analysis and explanations.
* **Session Management**: Uses SQLAlchemy with a SQLite database to track questions, saved answers, and API keys.
* **Streaming Responses**: Supports real-time AI response streaming for a smoother user experience.
* **CORS Enabled**: Fully configured for cross-origin requests from browser environments.

### User Scripts (Tampermonkey)

* **Universal Gemini Helper (UGH)**:
* **Selection Analysis**: Highlight text or images on any webpage and press the floating AI button to get instant explanations.
* **Image Support**: Automatically extracts images from the page, converts them to Base64, and sends them to the AI for visual analysis.


* **Educational Platform Enhancements (UETS)**:
* **Stealth Mode**: Features like "Spoof Fullscreen" and "Focus Spoofing" prevent sites from detecting tab switching or exiting fullscreen mode.
* **Time Management**: Automatically modifies "Time Taken" values and hijacks timers to maximize scores while maintaining a human-like appearance.
* **Answer Highlighting**: Identifies and highlights correct answers directly on the UI for supported platforms like Quizizz.
* **Custom Profiles**: Choose between different modes like "True Stealth," "Stealthy Extended," or "LMAO" for varying levels of automation.


## 🔮 Upcoming Features

* **EdPuzzle Support**: Support for EdPuzzle (even embedded in Canvas pages) will be added in the future.
* **Canvas Integration**: Support for Canvas quizzes/tests will be added soon.

## 🛠️ Project Structure

```text
├── api.py            # FastAPI application and endpoint definitions
├── ai.py             # Gemini client integration and AI processing logic
├── database.py       # SQLAlchemy engine and session configuration
├── schema.py         # Database models for questions and API keys
├── main.py           # Application entry point
├── tampermonkey/
│   ├── backend.js    # Core logic for API requests and key storage
│   ├── frontend.js   # UI components, floating buttons, and popups
│   └── uets.js       # Site-specific scripts for educational platforms

```

## ⚙️ Setup Instructions

### Backend Setup

1. **Clone the repository.**
2. **Install dependencies**:
```bash
pip install fastapi uvicorn sqlalchemy gemini-webapi python-dotenv

```


3. **Configure Environment Variables**:
Create a `.env` file in the root directory:
```env
SECURE_1PSID=your_google_1psid
SECURE_1PSIDTS=your_google_1psidts

```


4. **Run the Server**:
```bash
python main.py

```



### Client Setup

1. Install the [Tampermonkey](https://www.tampermonkey.net/) extension in your browser.
2. Add the scripts located in the `tampermonkey/` folder:
* `backend.js` (Required)
* `frontend.js` (Optional works on all sites, less useful than uets on its supported sites)
* `uets.js` (Optional, for specific platform tools, but much more integrated)


3. Configure your `serverUrl` in the script settings to match your running backend (default: `https://ugh.tully-dev.com`).

## 📝 Usage

* **Settings Menu**: Press and release the floating trigger button 3 times within 2 seconds to open the configuration menu.
* **Asking AI**: Highlight text/images and click the floating brain icon. For specific quiz platforms, "Ask AI" buttons will appear directly next to questions.

## ⚖️ License

This project is licensed under the **GPL-3.0 License**.
