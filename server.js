const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));

// Secure game databases hosted in server RAM
const activeRooms = {}; 

function generateFullDeck() {
    let deck = [];
    const cardNames = ["Card-A", "Card-B", "Card-C", "Card-D", "Card-E", "Card-F", "Card-G", "Card-H"];
    const colors = ["#b30000", "#e67e22", "#0033aa", "#8b5a2b", "#2ecc71", "#8e44ad"];
    
    for (let i = 0; i < 50; i++) {
        deck.push({
            id: 'c_' + i + '_' + Date.now(),
            name: cardNames[Math.floor(Math.random() * cardNames.length)],
            color: colors[Math.floor(Math.random() * colors.length)]
        });
    }
    return deck.sort(() => Math.random() - 0.5);
}

io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    // 1. Creation Protocol
    socket.on('createRoom', ({ roomName, password }) => {
        if (activeRooms[roomName]) {
            return socket.emit('errorMsg', 'Room name already exists!');
        }
        activeRooms[roomName] = {
            password: password,
            players: [socket.id],
            gameState: null
        };
        socket.join(roomName);
        socket.emit('roomCreatedSuccess', roomName);
        console.log(`Room created: ${roomName}`);
    });

    // 2. Access/Join Protocol
    socket.on('joinRoom', ({ roomName, password }) => {
        const room = activeRooms[roomName];
        if (!room) return socket.emit('errorMsg', 'Room not found!');
        if (room.password !== password) return socket.emit('errorMsg', 'Invalid password!');
        if (room.players.length >= 2) return socket.emit('errorMsg', 'Room is full! Maximum 2 players.');

        room.players.push(socket.id);
        socket.join(roomName);
        
        // Match Found: Trigger Core Setup Engine
        initiateGameEngine(roomName);
    });

    function initiateGameEngine(roomName) {
        const room = activeRooms[roomName];
        const deck = generateFullDeck();
        
        const p1_id = room.players[0];
        const p2_id = room.players[1];

        room.gameState = {
            deck: deck,
            turn: p1_id, // Host always initiates
            movesPlayedLeft: 3, // Max 3 per turn rule
            hasDrawnThisTurn: false,
            playerData: {
                [p1_id]: { hand: [], desk: [] },
                [p2_id]: { hand: [], desk: [] }
            }
        };

        // Deal 5 baseline cards securely
        for (let i = 0; i < 5; i++) {
            room.gameState.playerData[p1_id].hand.push(room.gameState.deck.pop());
            room.gameState.playerData[p2_id].hand.push(room.gameState.deck.pop());
        }

        distributeSecureState(roomName);
    }

    // Handles asymmetric information: Don't transmit enemy hands over the socket link
    function distributeSecureState(roomName) {
        const room = activeRooms[roomName];
        if (!room || !room.gameState) return;

        room.players.forEach(pid => {
            const opponentId = room.players.find(id => id !== pid);
            
            const securePackage = {
                roomCode: roomName,
                isMyTurn: room.gameState.turn === pid,
                movesPlayedLeft: room.gameState.movesPlayedLeft,
                hasDrawnThisTurn: room.gameState.hasDrawnThisTurn,
                deckCount: room.gameState.deck.length,
                myHand: room.gameState.playerData[pid].hand,
                myDesk: room.gameState.playerData[pid].desk,
                oppDesk: opponentId ? room.gameState.playerData[opponentId].desk : [],
                oppHandCount: opponentId ? room.gameState.playerData[opponentId].hand.length : 0
            };
            io.to(pid).emit('renderGameState', securePackage);
        });
    }

    // 3. Game Play Processing Engine
    socket.on('drawTwoCardsAction', (roomName) => {
        const room = activeRooms[roomName];
        if (!room || !room.gameState) return;
        if (room.gameState.turn !== socket.id) return socket.emit('errorMsg', "Not your turn!");
        if (room.gameState.hasDrawnThisTurn) return socket.emit('errorMsg', "You already drew cards!");

        // Pull 2 elements from stack
        if (room.gameState.deck.length >= 2) {
            room.gameState.playerData[socket.id].hand.push(room.gameState.deck.pop());
            room.gameState.playerData[socket.id].hand.push(room.gameState.deck.pop());
        }
        
        room.gameState.hasDrawnThisTurn = true;
        distributeSecureState(roomName);
    });

    socket.on('playCardAction', ({ roomName, cardId }) => {
        const room = activeRooms[roomName];
        if (!room || !room.gameState) return;
        if (room.gameState.turn !== socket.id) return socket.emit('errorMsg', "Not your turn!");
        if (!room.gameState.hasDrawnThisTurn) return socket.emit('errorMsg', "Draw cards from the deck first!");
        if (room.gameState.movesPlayedLeft <= 0) return socket.emit('errorMsg', "No actions remaining! Click End Turn.");

        const playerHand = room.gameState.playerData[socket.id].hand;
        const cardIndex = playerHand.findIndex(c => c.id === cardId);

        if (cardIndex !== -1) {
            const playedCard = playerHand.splice(cardIndex, 1)[0];
            room.gameState.playerData[socket.id].desk.push(playedCard);
            room.gameState.movesPlayedLeft--;
        }

        distributeSecureState(roomName);
    });

    socket.on('endTurnAction', (roomName) => {
        const room = activeRooms[roomName];
        if (!room || !room.gameState) return;
        if (room.gameState.turn !== socket.id) return socket.emit('errorMsg', "Not your turn!");

        const playerHand = room.gameState.playerData[socket.id].hand;
        
        // Enforce the 7-card maximum allocation limit
        if (playerHand.length > 7) {
            return socket.emit('errorMsg', `Hand size exceeds limit! You hold ${playerHand.length} cards. Discard feature coming, but rules forbid ending turn right now.`);
        }

        // Switch active turns
        const nextPlayer = room.players.find(id => id !== socket.id);
        room.gameState.turn = nextPlayer;
        room.gameState.movesPlayedLeft = 3;
        room.gameState.hasDrawnThisTurn = false;

        distributeSecureState(roomName);
    });

    socket.on('disconnect', () => {
        // Clean database memory allocations if players leave
        Object.keys(activeRooms).forEach(roomName => {
            const r = activeRooms[roomName];
            if (r.players.includes(socket.id)) {
                io.to(roomName).emit('errorMsg', 'Opponent disconnected. Refresh lobby.');
                delete activeRooms[roomName];
            }
        });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server executing seamlessly on port ${PORT}`));
