import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-app.js";
import { getFirestore, collection, getDocs } from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import { firebaseConfig } from "./secrets.js";

window.addEventListener('DOMContentLoaded', () => {
    const app = initializeApp(firebaseConfig);
    const db = getFirestore(app);

    const searchbar = document.getElementById("user-search");
    const searchbutton = document.getElementById("search-users");
    const resultsContainer = document.getElementById("results-container");

    const editDistance = (s1, s2) => {
        s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
        const costs = [];
        for (let i = 0; i <= s1.length; i++) {
            let lastValue = i;
            for (let j = 0; j <= s2.length; j++) {
                if (i === 0) costs[j] = j;
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
        const longerLength = longer.length;
        if (longerLength === 0) return 1.0;
        return (longerLength - editDistance(longer, shorter)) / longerLength;
    };

    const handleSearch = async () => {
        const query = searchbar.value.trim().toLowerCase();
        if (!query) return;
        try {
            const snapshot = await getDocs(collection(db, "users"));
            const results = [];
            snapshot.forEach(doc => {
                const user = doc.data();
                const username = (user.username || "").toLowerCase();
                if (username.includes(query) || similarity(username, query) >= 0.6) results.push(user);
            });
            displayResults(results);
        } catch (err) {
            console.error(err);
            resultsContainer.innerHTML = "<p>Error fetching data</p>";
        }
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
                </div>
            `;
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
                        <button id="pf-search-back">Back to Search</button>
                    </div>
                `;

                const addFriendBtn = document.getElementById("add-friend");
                addFriendBtn.addEventListener("click", () => {
                    alert("Friend request sent!");
                });

                const messageFriendBtn = document.getElementById("message-friend");
                messageFriendBtn.addEventListener("click", () => {
                    window.location.href = "chat.html";
                    const chatheader = document.getElementById("pf-search-h2");
                    chatheader.textContent = `Chat with ${user.username}`;
                });
            });
        });
    };

    resultsContainer.addEventListener('click', e => {
        if (e.target.id === 'pf-search-back') {
            handleSearch();
        }
    });

    searchbutton.addEventListener("click", handleSearch);
    searchbar.addEventListener("keydown", e => { if (e.key === "Enter") handleSearch(); });
});