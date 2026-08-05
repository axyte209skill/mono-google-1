const socket = io();
let currentActiveRoomCode = "";
let currentAuthMode = "create"; 
let stateCache = null;

function switchAuthTab(mode) {
    currentAuthMode = mode;
    document.getElementById('tab-create').classList.toggle('active', mode === 'create');
    document.getElementById('tab-join').classList.toggle('active', mode === 'join');
    document.getElementById('auth-action-btn').innerText = mode === 'create' ? "Construct Grid" : "Join Existing Room";
}

function executeAuth() {
    const roomName = document.getElementById('room-id-input').value.trim();
    const password = document.getElementById('room-pass-input').value.trim();

    if (!roomName || !password) return alert("Please populate all authorization fields.");

    if (currentAuthMode === "create") {
        socket.emit('createRoom', { roomName, password });
    } else {
        socket.emit('joinRoom', { roomName, password });
    }
}

// Intercept routing confirmation actions from server
socket.on('roomCreatedSuccess', (roomName) => {
    currentActiveRoomCode = roomName;
    document.getElementById('auth-screen').style.display = "none";
    document.getElementById('game-screen').style.display = "block";
    document.getElementById('display-room-id').innerText = roomName;
    document.getElementById('turn-indicator').innerText = "Waiting for an opponent to join...";
});

socket.on('renderGameState', (state) => {
    stateCache = state;
    currentActiveRoomCode = state.roomCode;

    // Single-Page View Transition Switch
    document.getElementById('auth-screen').style.display = "none";
    document.getElementById('game-screen').style.display = "block";
    
    // UI Label Processing Updates
    document.getElementById('display-room-id').innerText = state.roomCode;
    document.getElementById('deck-count-text').innerText = `(${state.deckCount})`;
    document.getElementById('action-counter').innerText = `Actions Left: ${state.movesPlayedLeft}`;
    document.getElementById('opp-hand-counter').innerText = `Opponent Table View (Hand Size: ${state.oppHandCount})`;
    document.getElementById('my-hand-title').innerText = `Your Private Hand (${state.myHand.length} / 7 Cards)`;

    // Process State Banner Colorizations
    const banner = document.getElementById('turn-indicator');
    const drawDeckElement = document.getElementById('central-draw-deck');
    
    if (state.isMyTurn) {
        banner.innerText = "YOUR ACTION PHASE";
        banner.style.background = "#04d361";
        if (!state.hasDrawnThisTurn) {
            drawDeckElement.classList.remove('disabled');
            banner.innerText = "DRAW 2 CARDS TO START TURN";
        } else {
            drawDeckElement.classList.add('disabled');
        }
    } else {
        banner.innerText = "OPPONENT ACTION PHASE";
        banner.style.background = "#da3731";
        drawDeckElement.classList.add('disabled');
    }

    // Render Arrays Into the Screen Objects
    renderCardArray(state.myHand, 'my-hand', true);
    renderCardArray(state.myDesk, 'my-desk', false);
    renderCardArray(state.oppDesk, 'opponent-desk', false);
});

function renderCardArray(cardsArray, targetHtmlElementId, clickIsEnabled) {
    const targetElement = document.getElementById(targetHtmlElementId);
    targetElement.innerHTML = "";

    if (cardsArray.length === 0) {
        targetElement.innerHTML = `<span style="color:#41414d; font-size:13px; margin:auto;">Empty Grid Space</span>`;
        return;
    }

    cardsArray.forEach(card => {
        const cardNode = document.createElement('div');
        cardNode.className = 'card';
        cardNode.style.backgroundColor = card.color;
        cardNode.innerHTML = `<span class="card-name">${card.name}</span>`;
        
        if (clickIsEnabled) {
            cardNode.onclick = () => triggerServerPlayCard(card.id);
        }
        targetElement.appendChild(cardNode);
    });
}

// Processing Action Commands Downstream
function triggerServerDraw() {
    if (!stateCache || !stateCache.isMyTurn || stateCache.hasDrawnThisTurn) return;
    socket.emit('drawTwoCardsAction', currentActiveRoomCode);
}

function triggerServerPlayCard(cardId) {
    if (!stateCache || !stateCache.isMyTurn) return alert("It is not your turn!");
    if (!stateCache.hasDrawnThisTurn) return alert("You must draw 2 cards from the deck first!");
    if (stateCache.movesPlayedLeft <= 0) return alert("No action tokens left this turn!");
    
    socket.emit('playCardAction', { roomName: currentActiveRoomCode, cardId });
}

function triggerServerEndTurn() {
    if (!stateCache || !stateCache.isMyTurn) return alert("It is not your turn!");
    socket.emit('endTurnAction', currentActiveRoomCode);
}

socket.on('errorMsg', (text) => {
    alert(`🚨 Server Notification: ${text}`);
});
