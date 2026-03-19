import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
    getFirestore, collection, getDocs, doc, setDoc, updateDoc, arrayUnion, getDoc
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
    getDatabase, ref, push, set, onValue
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { firebaseConfig } from "./secrets.js";

window.addEventListener("DOMContentLoaded", () => {
    const app = initializeApp(firebaseConfig);
    const fs = getFirestore(app);
    const rtdb = getDatabase(app);
    const auth = getAuth(app);

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const searchbar       = document.getElementById("user-search");
    const searchbutton    = document.getElementById("search-users");
    const resultsContainer = document.getElementById("results-container");

    const createGcBtn     = document.getElementById("create-gc-btn");
    const gcList          = document.getElementById("gc-list");

    const modalBackdrop   = document.getElementById("gc-modal-backdrop");
    const gcNameInput     = document.getElementById("gc-name-input");
    const gcUserSearch    = document.getElementById("gc-user-search");
    const modalUserRes    = document.getElementById("modal-user-results");
    const selectedMembers = document.getElementById("selected-members");
    const modalCancel     = document.getElementById("modal-cancel");
    const modalCreate     = document.getElementById("modal-create");

    // ── State ─────────────────────────────────────────────────────────────────
    let currentUser   = null;   // Firebase Auth user
    let allUsers      = [];     // cached Firestore users
    let pickedMembers = [];     // { uid, username } chosen for new group chat

    // ── Auth ──────────────────────────────────────────────────────────────────
    onAuthStateChanged(auth, user => {
        if (!user) { window.location.href = "./index.html"; return; }
        currentUser = user;
        loadGroupChats();
    });

    // ── Levenshtein / fuzzy ───────────────────────────────────────────────────
    const editDistance = (s1, s2) => {
        s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) { costs[j] = j; }
                else if (j > 0) {
                    let newValue = costs[j - 1];
                    if (s1.charAt(i - 1) !== s2.charAt(j - 1))
                        newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                    costs[j - 1] = lastValue;
                    lastValue = newValue;
                }
            }
            if (i > 0) costs[s2.length] = lastValue;
        }
        return costs[s2.length];
    };

    const similarity = (a, b) => {
        let longer = a, shorter = b;
        if (a.length < b.length) [longer, shorter] = [b, a];
        const length = longer.length;
        if (length === 0) return 1.0;
        return (length - editDistance(longer, shorter)) / length;
    };

    // ── User search (right panel) ─────────────────────────────────────────────
    const handleSearch = async () => {
        const query = searchbar.value.trim().toLowerCase();
        if (!query) return;

        try {
            const snapshot = await getDocs(collection(fs, "users"));
            const results = [];

            snapshot.forEach(docSnap => {
                const user = docSnap.data();
                user.uid = docSnap.id;
                if (query === "all") { results.push(user); return; }
                const username = (user.username || "").toLowerCase();
                if (username.includes(query) || similarity(username, query) >= 0.6)
                    results.push(user);
            });

            displayResults(results);
        } catch (err) {
            console.error(err);
            resultsContainer.innerHTML = "<p>Error fetching data.</p>";
        }
    };

    const sendFriendRequest = async (targetId) => {
        if (!currentUser) { alert("Please log in."); return; }
        await setDoc(doc(fs, "users", targetId, "friends", currentUser.uid), { accepted: false });
        alert("Friend request sent.");
    };

    const displayResults = (results) => {
        resultsContainer.innerHTML = "";
        if (results.length === 0) { resultsContainer.innerHTML = "<p>No results found.</p>"; return; }

        results.forEach(user => {
            const userDiv = document.createElement("div");
            userDiv.classList.add("user-result");
            userDiv.innerHTML = `
                <div class="avatar"></div>
                <div class="user-info">
                    <h3>${user.username}</h3>
                    <p>${user.email}</p>
                </div>`;
            resultsContainer.appendChild(userDiv);

            userDiv.addEventListener("click", () => {
                resultsContainer.innerHTML = `
                    <div id="pf-search-container">
                        <h2 id="pf-search-h2">${user.username}'s Profile</h2>
                        <p id="pf-search-email"><strong>Email:</strong> ${user.email}</p>
                        <p id="pf-search-bio"><strong>Bio:</strong> ${user.bio || "N/A"}</p>
                        <div id="friend-btns">
                            <div id="add-friend">Add Friend</div>
                            <div id="message-friend">Message</div>
                        </div>
                        <button id="pf-search-back">Back</button>
                    </div>`;

                document.getElementById("add-friend").addEventListener("click", () => sendFriendRequest(user.uid));
                document.getElementById("message-friend").addEventListener("click", () => {
                    window.location.href = "chat.html";
                });
            });
        });
    };

    resultsContainer.addEventListener("click", e => {
        if (e.target.id === "pf-search-back") handleSearch();
    });

    searchbutton.addEventListener("click", handleSearch);
    searchbar.addEventListener("keydown", e => { if (e.key === "Enter") handleSearch(); });

    // ── Load & display group chats ────────────────────────────────────────────
    function loadGroupChats() {
        if (!currentUser) return;

        // Listen to all groupChats in RTDB, then filter by membership
        onValue(ref(rtdb, "groupChats"), snap => {
            gcList.innerHTML = "";
            if (!snap.exists()) return;

            snap.forEach(child => {
                const gc = child.val();
                const gcId = child.key;
                const members = gc.members || {};

                // Only show chats this user is in
                if (!members[currentUser.uid]) return;

                const memberNames = Object.values(members).join(", ");

                const item = document.createElement("div");
                item.className = "gc-item";
                item.innerHTML = `
                    <div class="gc-name">${escapeHtml(gc.name || "Unnamed")}</div>
                    <div class="gc-members">${escapeHtml(memberNames)}</div>`;

                item.addEventListener("click", () => {
                    window.location.href = `chat.html?gc=${gcId}`;
                });

                gcList.appendChild(item);
            });
        }, err => console.error("groupChats onValue error", err));
    }

    // ── Modal: open / close ───────────────────────────────────────────────────
    createGcBtn.addEventListener("click", async () => {
        pickedMembers = [];
        gcNameInput.value = "";
        gcUserSearch.value = "";
        modalUserRes.innerHTML = "";
        renderChips();
        modalBackdrop.style.display = "flex";

        // Pre-fetch all users once for modal search
        if (allUsers.length === 0) {
            const snap = await getDocs(collection(fs, "users"));
            snap.forEach(d => { const u = d.data(); u.uid = d.id; allUsers.push(u); });
        }
    });

    modalCancel.addEventListener("click", closeModal);
    modalBackdrop.addEventListener("click", e => { if (e.target === modalBackdrop) closeModal(); });

    function closeModal() {
        modalBackdrop.style.display = "none";
    }

    // ── Modal: user search ────────────────────────────────────────────────────
    gcUserSearch.addEventListener("input", () => {
        const q = gcUserSearch.value.trim().toLowerCase();
        modalUserRes.innerHTML = "";
        if (!q) return;

        const matches = allUsers.filter(u => {
            if (u.uid === currentUser.uid) return false; // exclude self
            const name = (u.username || "").toLowerCase();
            return name.includes(q) || similarity(name, q) >= 0.6;
        }).slice(0, 8);

        matches.forEach(u => {
            const row = document.createElement("div");
            row.className = "modal-user-row";
            const alreadyPicked = pickedMembers.some(m => m.uid === u.uid);
            row.innerHTML = `
                <span>${escapeHtml(u.username)}</span>
                <button class="${alreadyPicked ? "remove-btn" : "add-btn"}">
                    ${alreadyPicked ? "Remove" : "Add"}
                </button>`;
            row.querySelector("button").addEventListener("click", () => {
                if (alreadyPicked) {
                    pickedMembers = pickedMembers.filter(m => m.uid !== u.uid);
                } else {
                    pickedMembers.push({ uid: u.uid, username: u.username });
                }
                renderChips();
                // Re-render list to flip button state
                gcUserSearch.dispatchEvent(new Event("input"));
            });
            modalUserRes.appendChild(row);
        });
    });

    function renderChips() {
        selectedMembers.innerHTML = "";
        pickedMembers.forEach(m => {
            const chip = document.createElement("div");
            chip.className = "member-chip";
            chip.innerHTML = `${escapeHtml(m.username)} <span data-uid="${m.uid}">✕</span>`;
            chip.querySelector("span").addEventListener("click", () => {
                pickedMembers = pickedMembers.filter(x => x.uid !== m.uid);
                renderChips();
                gcUserSearch.dispatchEvent(new Event("input"));
            });
            selectedMembers.appendChild(chip);
        });
    }

    // ── Modal: create group chat ──────────────────────────────────────────────
    modalCreate.addEventListener("click", async () => {
        const name = gcNameInput.value.trim();
        if (!name) { alert("Please enter a group chat name."); return; }
        if (pickedMembers.length === 0) { alert("Add at least one member."); return; }

        // Build members map: { uid: username, ... } — includes self
        const membersMap = {};
        membersMap[currentUser.uid] = currentUser.displayName || currentUser.email.split("@")[0];
        pickedMembers.forEach(m => { membersMap[m.uid] = m.username; });

        try {
            // 1. Push new group chat to Realtime DB
            const newGcRef = push(ref(rtdb, "groupChats"));
            const gcId = newGcRef.key;

            await set(newGcRef, {
                name,
                members: membersMap,
                createdAt: Date.now(),
                createdBy: currentUser.uid
            });

            // 2. Add gcId to each member's Firestore doc
            const allMemberUids = Object.keys(membersMap);
            const updatePromises = allMemberUids.map(uid =>
                updateDoc(doc(fs, "users", uid), {
                    groupChats: arrayUnion(gcId)
                })
            );
            await Promise.all(updatePromises);

            closeModal();
            // Navigate into the new chat immediately
            window.location.href = `chat.html?gc=${gcId}`;
        } catch (err) {
            console.error("Failed to create group chat:", err);
            alert("Something went wrong. Check the console.");
        }
    });

    // ── Utility ───────────────────────────────────────────────────────────────
    function escapeHtml(str) {
        if (typeof str !== "string") return "";
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }
});