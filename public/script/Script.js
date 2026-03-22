import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import {
    getFirestore, collection, getDocs, doc, setDoc, getDoc, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
    getDatabase, ref, push, set, onValue, get, remove, update
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-database.js";
import {
    getAuth, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";
import { updateDoc, arrayUnion, arrayRemove } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { firebaseConfig } from "./secrets.js";

window.addEventListener("DOMContentLoaded", () => {
    const app  = initializeApp(firebaseConfig);
    const fs   = getFirestore(app);
    const rtdb = getDatabase(app);
    const auth = getAuth(app);

    // ── DOM refs ──────────────────────────────────────────────────────────────
    const searchbar        = document.getElementById("user-search");
    const searchbutton     = document.getElementById("search-users");
    const resultsContainer = document.getElementById("results-container");

    // Sidebar / tabs
    const tabBtns          = document.querySelectorAll(".tab-btn");
    const panels           = document.querySelectorAll(".panel");
    const dmList           = document.getElementById("dm-list");
    const gcList           = document.getElementById("gc-list");
    const mobileMenuBtn    = document.getElementById("mobile-menu-btn");
    const sidebarOverlay   = document.getElementById("sidebar-overlay");
    const sidebar          = document.getElementById("left");

    // GC modal
    const createGcBtn      = document.getElementById("create-gc-btn");
    const gcModalBackdrop  = document.getElementById("gc-modal-backdrop");
    const gcNameInput      = document.getElementById("gc-name-input");
    const gcUserSearch     = document.getElementById("gc-user-search");
    const modalUserRes     = document.getElementById("modal-user-results");
    const selectedMembers  = document.getElementById("selected-members");
    const modalCancel      = document.getElementById("modal-cancel");
    const modalCreate      = document.getElementById("modal-create");

    // Add friend modal
    const openAddFriendBtn = document.getElementById("open-add-friend-btn");
    const addFriendBackdrop= document.getElementById("add-friend-backdrop");
    const afUserSearch     = document.getElementById("af-user-search");
    const afResults        = document.getElementById("af-results");
    const afCancel         = document.getElementById("af-cancel");

    // Friend requests modal
    const openRequestsBtn  = document.getElementById("open-requests-btn");
    const requestsBackdrop = document.getElementById("requests-backdrop");
    const requestsList     = document.getElementById("requests-list");
    const requestsClose    = document.getElementById("requests-close");
    const requestsBadge    = document.getElementById("requests-badge");

    // ── State ─────────────────────────────────────────────────────────────────
    let currentUser   = null;
    let allUsers      = [];
    let pickedMembers = [];

    // ── Auth ──────────────────────────────────────────────────────────────────
    onAuthStateChanged(auth, user => {
        if (!user) { window.location.href = "./index.html"; return; }
        currentUser = user;
        loadDMs();
        loadGroupChats();
        loadFriendRequests();
    });

    // ── Mobile sidebar ────────────────────────────────────────────────────────
    mobileMenuBtn.addEventListener("click", () => {
        sidebar.classList.toggle("sidebar-open");
        sidebarOverlay.classList.toggle("overlay-visible");
    });

    sidebarOverlay.addEventListener("click", closeSidebar);

    function closeSidebar() {
        sidebar.classList.remove("sidebar-open");
        sidebarOverlay.classList.remove("overlay-visible");
    }

    // ── Tabs ──────────────────────────────────────────────────────────────────
    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            panels.forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(`panel-${btn.dataset.tab}`).classList.add("active");
        });
    });

    // ── Fuzzy search ─────────────────────────────────────────────────────────
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

        resultsContainer.innerHTML = `<div class="empty-state"><div class="empty-icon" style="font-size:32px;animation:spin 1s linear infinite">⟳</div><p>Searching…</p></div>`;

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
            resultsContainer.innerHTML = "<p style='padding:20px;color:var(--danger)'>Error fetching users.</p>";
        }
    };

    const sendFriendRequest = async (targetId) => {
        if (!currentUser) { alert("Please log in."); return; }
        await setDoc(doc(fs, "users", targetId, "friends", currentUser.uid), { accepted: false });
        alert("Friend request sent!");
    };

    const getInitials = (name = "") => {
        const parts = name.trim().split(" ");
        if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
        return (name[0] || "?").toUpperCase();
    };

    const displayResults = (results) => {
        resultsContainer.innerHTML = "";
        if (results.length === 0) {
            resultsContainer.innerHTML = `<div class="empty-state"><div class="empty-icon">😶</div><p>No users found matching that query.</p></div>`;
            return;
        }

        results.forEach((user, i) => {
            const userDiv = document.createElement("div");
            userDiv.classList.add("user-result");
            userDiv.style.animationDelay = `${i * 0.04}s`;
            userDiv.innerHTML = `
                <div class="avatar">${getInitials(user.username)}</div>
                <div class="user-info">
                    <h3>${escapeHtml(user.username)}</h3>
                    <p>${escapeHtml(user.email)}</p>
                </div>`;
            resultsContainer.appendChild(userDiv);

            userDiv.addEventListener("click", () => {
                resultsContainer.innerHTML = `
                    <div id="pf-search-container">
                        <div class="pf-avatar-lg">${getInitials(user.username)}</div>
                        <h2 id="pf-search-h2">${escapeHtml(user.username)}</h2>
                        <div class="pf-detail-row">
                            <span class="pf-detail-label">Email</span>
                            <span>${escapeHtml(user.email)}</span>
                        </div>
                        <div class="pf-detail-row">
                            <span class="pf-detail-label">Bio</span>
                            <span>${escapeHtml(user.bio || "No bio yet")}</span>
                        </div>
                        <div class="pf-actions">
                            <button class="pf-btn primary" id="add-friend-pf">Add Friend</button>
                            <button class="pf-btn secondary" id="message-friend-pf">Message</button>
                        </div>
                        <button id="pf-search-back">← Back to results</button>
                    </div>`;

                document.getElementById("add-friend-pf").addEventListener("click", () => sendFriendRequest(user.uid));
                document.getElementById("message-friend-pf").addEventListener("click", () => {
                    window.location.href = "chat.html";
                });
                document.getElementById("pf-search-back").addEventListener("click", handleSearch);
            });
        });
    };

    searchbutton.addEventListener("click", handleSearch);
    searchbar.addEventListener("keydown", e => { if (e.key === "Enter") handleSearch(); });

    // ── Load DMs ──────────────────────────────────────────────────────────────
    // DMs are stored in RTDB under "dms/{dmId}" where the dmId = sorted uid pair
    // Each DM object: { members: { uid: username }, lastMessage, lastAt }
    function loadDMs() {
        if (!currentUser) return;

        onValue(ref(rtdb, "dms"), snap => {
            // Filter DMs where this user is a member
            const myDMs = [];
            if (snap.exists()) {
                snap.forEach(child => {
                    const dm = child.val();
                    if (dm.members && dm.members[currentUser.uid]) {
                        myDMs.push({ id: child.key, ...dm });
                    }
                });
            }

            dmList.innerHTML = "";

            if (myDMs.length === 0) {
                dmList.innerHTML = `<div class="empty-state"><div class="empty-icon">💬</div><p>No direct messages yet. Add a friend to get started.</p></div>`;
                return;
            }

            myDMs
                .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))
                .forEach(dm => {
                    const members = dm.members || {};
                    // Find the other person
                    const otherUid = Object.keys(members).find(uid => uid !== currentUser.uid);
                    const otherName = otherUid ? members[otherUid] : "Unknown";
                    const initials = getInitials(otherName);

                    const item = document.createElement("div");
                    item.className = "conv-item";
                    item.innerHTML = `
                        <div class="conv-avatar">${escapeHtml(initials)}
                            <div class="online-dot"></div>
                        </div>
                        <div class="conv-info">
                            <div class="conv-name">${escapeHtml(otherName)}</div>
                            <div class="conv-preview">${escapeHtml(dm.lastMessage || "No messages yet")}</div>
                        </div>`;

                    item.addEventListener("click", () => {
                        closeSidebar();
                        window.location.href = `chat.html?dm=${dm.id}`;
                    });
                    dmList.appendChild(item);
                });
        }, err => console.error("DMs onValue error", err));
    }

    // ── Load Group Chats ──────────────────────────────────────────────────────
    function loadGroupChats() {
        if (!currentUser) return;

        onValue(ref(rtdb, "groupChats"), snap => {
            gcList.innerHTML = "";

            if (!snap.exists()) {
                gcList.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>No group chats yet.</p></div>`;
                return;
            }

            const myGCs = [];
            snap.forEach(child => {
                const gc = child.val();
                if (gc.members && gc.members[currentUser.uid]) {
                    myGCs.push({ id: child.key, ...gc });
                }
            });

            if (myGCs.length === 0) {
                gcList.innerHTML = `<div class="empty-state"><div class="empty-icon">👥</div><p>No group chats yet. Create one above.</p></div>`;
                return;
            }

            myGCs
                .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
                .forEach(gc => {
                    const memberNames = Object.values(gc.members || {}).join(", ");
                    const isCreator = gc.createdBy === currentUser.uid;

                    const item = document.createElement("div");
                    item.className = "conv-item";
                    item.innerHTML = `
                        <div class="conv-avatar gc-avatar">👥</div>
                        <div class="conv-info">
                            <div class="conv-name">${escapeHtml(gc.name || "Unnamed Group")}</div>
                            <div class="conv-preview">${escapeHtml(memberNames)}</div>
                        </div>
                        ${isCreator ? `<button class="gc-delete-btn" data-gcid="${gc.id}" title="Delete group chat">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                            </svg>
                        </button>` : ""}`;

                    // Click the item itself (not the delete btn) → navigate
                    item.addEventListener("click", (e) => {
                        if (e.target.closest(".gc-delete-btn")) return;
                        closeSidebar();
                        window.location.href = `chat.html?gc=${gc.id}`;
                    });

                    // Delete button
                    if (isCreator) {
                        item.querySelector(".gc-delete-btn").addEventListener("click", async (e) => {
                            e.stopPropagation();
                            if (!confirm(`Delete "${gc.name}"? This cannot be undone.`)) return;
                            try {
                                // Remove from RTDB
                                await remove(ref(rtdb, `groupChats/${gc.id}`));
                                // Remove gcId from each member's Firestore doc
                                const memberUids = Object.keys(gc.members || {});
                                await Promise.all(memberUids.map(uid =>
                                    updateDoc(doc(fs, "users", uid), { groupChats: arrayRemove(gc.id) })
                                ));
                            } catch (err) {
                                console.error("Delete GC error:", err);
                                alert("Failed to delete group chat.");
                            }
                        });
                    }

                    gcList.appendChild(item);
                });
        }, err => console.error("groupChats onValue error", err));
    }

    // ── GC Modal ──────────────────────────────────────────────────────────────
    createGcBtn.addEventListener("click", async () => {
        pickedMembers = [];
        gcNameInput.value = "";
        gcUserSearch.value = "";
        modalUserRes.innerHTML = "";
        renderChips();
        gcModalBackdrop.classList.add("open");

        if (allUsers.length === 0) {
            const snap = await getDocs(collection(fs, "users"));
            snap.forEach(d => { const u = d.data(); u.uid = d.id; allUsers.push(u); });
        }
    });

    modalCancel.addEventListener("click", () => gcModalBackdrop.classList.remove("open"));
    gcModalBackdrop.addEventListener("click", e => {
        if (e.target === gcModalBackdrop) gcModalBackdrop.classList.remove("open");
    });

    gcUserSearch.addEventListener("input", () => renderModalSearch(gcUserSearch, modalUserRes));

    function renderModalSearch(input, container) {
        const q = input.value.trim().toLowerCase();
        container.innerHTML = "";
        if (!q) return;

        const matches = allUsers.filter(u => {
            if (u.uid === currentUser.uid) return false;
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
                if (alreadyPicked) pickedMembers = pickedMembers.filter(m => m.uid !== u.uid);
                else pickedMembers.push({ uid: u.uid, username: u.username });
                renderChips();
                input.dispatchEvent(new Event("input"));
            });
            container.appendChild(row);
        });
    }

    function renderChips() {
        selectedMembers.innerHTML = "";
        pickedMembers.forEach(m => {
            const chip = document.createElement("div");
            chip.className = "member-chip";
            chip.innerHTML = `${escapeHtml(m.username)} <span class="chip-x" data-uid="${m.uid}">✕</span>`;
            chip.querySelector(".chip-x").addEventListener("click", () => {
                pickedMembers = pickedMembers.filter(x => x.uid !== m.uid);
                renderChips();
                gcUserSearch.dispatchEvent(new Event("input"));
            });
            selectedMembers.appendChild(chip);
        });
    }

    modalCreate.addEventListener("click", async () => {
        const name = gcNameInput.value.trim();
        if (!name)                    { alert("Enter a group name."); return; }
        if (pickedMembers.length === 0) { alert("Add at least one member."); return; }

        const membersMap = {};
        membersMap[currentUser.uid] = currentUser.displayName || currentUser.email.split("@")[0];
        pickedMembers.forEach(m => { membersMap[m.uid] = m.username; });

        try {
            const newGcRef = push(ref(rtdb, "groupChats"));
            const gcId = newGcRef.key;

            await set(newGcRef, {
                name,
                members: membersMap,
                createdAt: Date.now(),
                createdBy: currentUser.uid
            });

            await Promise.all(
                Object.keys(membersMap).map(uid =>
                    updateDoc(doc(fs, "users", uid), { groupChats: arrayUnion(gcId) })
                )
            );

            gcModalBackdrop.classList.remove("open");
            window.location.href = `chat.html?gc=${gcId}`;
        } catch (err) {
            console.error("Failed to create group chat:", err);
            alert("Something went wrong. Check the console.");
        }
    });

    // ── Add Friend Modal ──────────────────────────────────────────────────────
    openAddFriendBtn.addEventListener("click", async () => {
        afUserSearch.value = "";
        afResults.innerHTML = "";
        addFriendBackdrop.classList.add("open");

        if (allUsers.length === 0) {
            const snap = await getDocs(collection(fs, "users"));
            snap.forEach(d => { const u = d.data(); u.uid = d.id; allUsers.push(u); });
        }
    });

    afCancel.addEventListener("click", () => addFriendBackdrop.classList.remove("open"));
    addFriendBackdrop.addEventListener("click", e => {
        if (e.target === addFriendBackdrop) addFriendBackdrop.classList.remove("open");
    });

    afUserSearch.addEventListener("input", () => {
        const q = afUserSearch.value.trim().toLowerCase();
        afResults.innerHTML = "";
        if (!q) return;

        const matches = allUsers.filter(u => {
            if (u.uid === currentUser.uid) return false;
            const name = (u.username || "").toLowerCase();
            return name.includes(q) || similarity(name, q) >= 0.6;
        }).slice(0, 8);

        matches.forEach(u => {
            const row = document.createElement("div");
            row.className = "modal-user-row";
            row.innerHTML = `
                <span>${escapeHtml(u.username)}</span>
                <button class="add-btn">Add</button>`;
            row.querySelector("button").addEventListener("click", async () => {
                await sendFriendRequest(u.uid);
                row.querySelector("button").textContent = "Sent ✓";
                row.querySelector("button").disabled = true;
                row.querySelector("button").style.opacity = "0.6";
            });
            afResults.appendChild(row);
        });

        if (matches.length === 0) {
            afResults.innerHTML = `<p style="color:var(--text-muted);font-size:13px;padding:10px 0">No users found.</p>`;
        }
    });

    // ── Friend Requests ───────────────────────────────────────────────────────
    function loadFriendRequests() {
        if (!currentUser) return;

        // Listen to current user's friends subcollection for pending requests
        const friendsRef = collection(fs, "users", currentUser.uid, "friends");
        onSnapshot(friendsRef, async snap => {
            const pending = [];
            snap.forEach(d => {
                const data = d.data();
                // accepted: false = pending incoming request (sender uid = d.id)
                if (data.accepted === false) {
                    pending.push({ senderUid: d.id, ...data });
                }
            });

            // Update badge
            if (pending.length > 0) {
                requestsBadge.style.display = "flex";
                requestsBadge.textContent = pending.length;
            } else {
                requestsBadge.style.display = "none";
            }

            // Render list if modal is open
            renderRequestsList(pending);
        });
    }

    async function renderRequestsList(pending) {
        requestsList.innerHTML = "";
        if (pending.length === 0) {
            requestsList.innerHTML = `<div class="empty-state"><div class="empty-icon">🔔</div><p>No pending requests.</p></div>`;
            return;
        }

        // Fetch sender usernames
        for (const req of pending) {
            let senderName = req.senderUid;
            try {
                const userDoc = await getDoc(doc(fs, "users", req.senderUid));
                if (userDoc.exists()) senderName = userDoc.data().username || req.senderUid;
            } catch (_) {}

            const row = document.createElement("div");
            row.className = "request-row";
            row.innerHTML = `
                <div class="request-avatar">${getInitials(senderName)}</div>
                <div class="request-info">
                    <div class="request-name">${escapeHtml(senderName)}</div>
                    <div class="request-sub">Wants to be your friend</div>
                </div>
                <div class="request-actions">
                    <button class="req-accept-btn" data-uid="${req.senderUid}">Accept</button>
                    <button class="req-reject-btn" data-uid="${req.senderUid}">Decline</button>
                </div>`;

            row.querySelector(".req-accept-btn").addEventListener("click", async () => {
                await acceptFriendRequest(req.senderUid);
                row.remove();
            });

            row.querySelector(".req-reject-btn").addEventListener("click", async () => {
                await rejectFriendRequest(req.senderUid);
                row.remove();
            });

            requestsList.appendChild(row);
        }
    }

    async function acceptFriendRequest(senderUid) {
        try {
            // Mark accepted on both sides
            await updateDoc(doc(fs, "users", currentUser.uid, "friends", senderUid), { accepted: true });
            await setDoc(doc(fs, "users", senderUid, "friends", currentUser.uid), { accepted: true });

            // Create a DM conversation in RTDB if one doesn't exist yet
            // Use a deterministic ID: sort both UIDs so A-B == B-A
            const dmId = [currentUser.uid, senderUid].sort().join("_");
            const dmRef = ref(rtdb, `dms/${dmId}`);
            const snap = await get(dmRef);

            if (!snap.exists()) {
                // Fetch sender's username for the members map
                let senderName = senderUid;
                try {
                    const senderDoc = await getDoc(doc(fs, "users", senderUid));
                    if (senderDoc.exists()) senderName = senderDoc.data().username || senderUid;
                } catch (_) {}

                const myName = currentUser.displayName || currentUser.email.split("@")[0];

                await set(dmRef, {
                    members: {
                        [currentUser.uid]: myName,
                        [senderUid]: senderName
                    },
                    lastMessage: "",
                    lastAt: Date.now(),
                    createdAt: Date.now()
                });
            }
        } catch (err) { console.error("Accept error:", err); }
    }

    async function rejectFriendRequest(senderUid) {
        try {
            await deleteDoc(doc(fs, "users", currentUser.uid, "friends", senderUid));
        } catch (err) { console.error("Reject error:", err); }
    }

    openRequestsBtn.addEventListener("click", () => requestsBackdrop.classList.add("open"));
    requestsClose.addEventListener("click", () => requestsBackdrop.classList.remove("open"));
    requestsBackdrop.addEventListener("click", e => {
        if (e.target === requestsBackdrop) requestsBackdrop.classList.remove("open");
    });

    // ── Utility ───────────────────────────────────────────────────────────────
    function escapeHtml(str) {
        if (typeof str !== "string") return "";
        const d = document.createElement("div");
        d.textContent = str;
        return d.innerHTML;
    }
});