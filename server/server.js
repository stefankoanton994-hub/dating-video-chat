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

// Статические файлы
app.use(express.static(path.join(__dirname, '../client')));

// Добавьте корневой маршрут
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// Данные о пользователях
const users = new Map();

// Доступные города
const availableCities = [
  'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург', 'Казань',
  'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону'
];

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

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
    
    // Ищем партнера
    const waitingUsers = Array.from(users.values())
      .filter(user => 
        user.city === city && 
        user.socketId !== socket.id && 
        !user.partnerId
      );

    if (waitingUsers.length > 0) {
      const partner = waitingUsers[0];
      
      // Обновляем данные о партнерах
      users.get(partner.socketId).partnerId = socket.id;
      users.get(socket.id).partnerId = partner.socketId;

      // Уведомляем пользователей
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

      console.log(`Matched: ${socket.id} and ${partner.socketId} in ${city}`);
    } else {
      socket.emit('waiting-for-partner');
      console.log(`User ${socket.id} waiting in ${city}`);
    }

    // Обновляем счетчик пользователей
    const roomUsers = Array.from(users.values()).filter(user => user.city === city);
    io.to(city).emit('users-in-room', roomUsers.length);
  });

  // WebRTC signaling
  socket.on('webrtc-offer', (data) => {
    console.log('Offer from', socket.id, 'to', data.target);
    socket.to(data.target).emit('webrtc-offer', {
      sdp: data.sdp,
      sender: socket.id
    });
  });

  socket.on('webrtc-answer', (data) => {
    console.log('Answer from', socket.id, 'to', data.target);
    socket.to(data.target).emit('webrtc-answer', {
      sdp: data.sdp,
      sender: socket.id
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.target).emit('ice-candidate', {
      candidate: data.candidate,
      sender: socket.id
    });
  });

  // Смена партнера
  socket.on('next-partner', () => {
    const user = users.get(socket.id);
    if (user && user.partnerId) {
      const partnerId = user.partnerId;
      
      // Уведомляем партнера
      socket.to(partnerId).emit('partner-disconnected');
      
      // Сбрасываем партнеров
      users.get(partnerId).partnerId = null;
      user.partnerId = null;
      
      // Ищем нового партнера
      findNewPartner(socket.id, user.city);
    }
  });

  // Сообщения чата
  socket.on('send-message', (data) => {
    const user = users.get(socket.id);
    if (user && user.partnerId) {
      socket.to(user.partnerId).emit('new-message', {
        text: data.text,
        sender: user.name,
        timestamp: new Date().toLocaleTimeString()
      });
    }
  });

  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      // Уведомляем партнера
      if (user.partnerId) {
        socket.to(user.partnerId).emit('partner-disconnected');
        const partner = users.get(user.partnerId);
        if (partner) {
          partner.partnerId = null;
        }
      }

      // Обновляем счетчик в комнате
      if (user.city) {
        const roomUsers = Array.from(users.values()).filter(u => u.city === user.city && u.socketId !== socket.id);
        socket.to(user.city).emit('users-in-room', roomUsers.length);
      }

      users.delete(socket.id);
    }
    console.log('User disconnected:', socket.id);
  });
});

function findNewPartner(userId, city) {
  const user = users.get(userId);
  if (!user) return;

  const waitingUsers = Array.from(users.values())
    .filter(u => u.city === city && u.socketId !== userId && !u.partnerId);

  if (waitingUsers.length > 0) {
    const partner = waitingUsers[0];
    
    user.partnerId = partner.socketId;
    partner.partnerId = userId;

    const userSocket = io.sockets.sockets.get(userId);
    const partnerSocket = io.sockets.sockets.get(partner.socketId);

    userSocket.emit('partner-found', {
      partnerId: partner.socketId,
      partnerData: {
        name: partner.name,
        age: partner.age,
        gender: partner.gender
      }
    });

    partnerSocket.emit('partner-found', {
      partnerId: userId,
      partnerData: {
        name: user.name,
        age: user.age,
        gender: user.gender
      }
    });
  } else {
    io.sockets.sockets.get(userId).emit('waiting-for-partner');
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});