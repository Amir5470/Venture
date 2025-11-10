# Venture

A simple chat application built with Electron, Firebase and modern web tech.

## 🧩 Features

- Sign up/login with Google, GitHub or email & password  
- Real-time chat interface  
- User profiles & friend list  
- Deployed via Firebase Hosting  
- Cross-platform desktop app via Electron  

## 🔧 Tech Stack

- **Frontend**: HTML, CSS, JavaScript  
- **Desktop wrapper**: Electron  
- **Backend / Auth / Hosting**: Firebase (Auth, Firestore, Hosting)  
- **Version control**: Git / GitHub  

## 🚀 Getting Started

### Prerequisites  
- Node.js & npm installed  
- A Firebase project set up with Auth & Firestore  
- Registered OAuth providers (Google, GitHub) in Firebase  

### Installation  
```bash
git clone https://github.com/Amir5470/Venture.git
cd Venture
npm install
Setup
Copy secrets.js.example (or whatever your config file is) to secrets.js

Populate it with your Firebase config & OAuth client IDs

In Firebase Console → Authentication → Authorized domains, add your hosting domain

In GitHub/OAuth providers, ensure redirect URI matches your hosting handler

Run locally (for Electron) with:

bash

npm start
Build for production:

bash

npm run build
Deployment
Hosted at: https://venture-chat.firebaseapp.com/
To deploy:

bash
firebase deploy
📁 Project Structure
css
/src
  /main
    (Electron main process code)
  /public
    (HTML, CSS, JS for UI)
/.firebase
.gitignore  
package.json  
firebase.json  
🤝 Contributing
Feel free to open issues, suggest features, or submit pull requests.
Please follow standard GitHub workflow (fork → branch → PR) and keep commits clean.

✅ License
This project is licensed under the MIT License. See LICENSE for details.

📬 Contact
Developed by Amir5470.
For questions or feedback, reach out via GitHub.