const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, '../client')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

const users = new Map();
const availableCities = [
  'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань',
  'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону'
];

io.on('connection', (socket) => {
  console.log('🔊 User connected:', socket.id);

  socket.emit('cities-list', availableCities);

  socket.on('join-city', (data) => {
    const { city, userData } = data;
    
    users.set(socket.id, {
      ...userData,
      city: city,
      socketId: socket.id,
      partnerId: null
    });

    socket.join(city);
    
    const waitingUsers = Array.from(users.values())
      .filter(user => user.city === city && user.socketId !== socket.id && !user.partnerId);

    if (waitingUsers.length > 0) {
      const partner = waitingUsers[0];
      
      users.get(partner.socketId).partnerId = socket.id;
      users.get(socket.id).partnerId = partner.socketId;

      console.log(`🎯 Audio match: ${socket.id} and ${partner.socketId} in ${city}`);

      socket.emit('partner-found', { 
        partnerId: partner.socketId,
        partnerData: {
          name: partner.name,
          age: partner.age,
          gender: partner.gender
        }
      });

      socket.to(partner.socketId).emit('partner-found', {
        partnerId: socket.id,
        partnerData: {
          name: userData.name,
          age: userData.age,
          gender: userData.gender
        }
      });

    } else {
      socket.emit('waiting-for-partner');
      console.log(`⏳ User ${socket.id} waiting in ${city}`);
    }

    const roomUsers = Array.from(users.values()).filter(user => user.city === city);
    io.to(city).emit('users-in-room', roomUsers.length);
  });

  // Симуляция активности говорящего
  socket.on('user-speaking', (data) => {
    const user = users.get(socket.id);
    if (user && user.partnerId) {
      socket.to(user.partnerId).emit('partner-speaking', {
        volume: data.volume,
        isSpeaking: data.isSpeaking
      });
    }
  });

  socket.on('next-partner', () => {
    const user = users.get(socket.id);
    if (user && user.partnerId) {
      const partnerId = user.partnerId;
      socket.to(partnerId).emit('partner-disconnected');
      
      if (users.get(partnerId)) {
        users.get(partnerId).partnerId = null;
      }
      user.partnerId = null;
      
      socket.emit('waiting-for-partner');
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      if (user.partnerId) {
        socket.to(user.partnerId).emit('partner-disconnected');
        const partner = users.get(user.partnerId);
        if (partner) partner.partnerId = null;
      }
      users.delete(socket.id);
    }
    console.log('🔇 User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 AudioChat server running on port ${PORT}`);
});