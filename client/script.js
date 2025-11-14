class VideoChatApp {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.currentCity = null;
        this.userData = null;
        this.partnerData = null;
        
        this.initializeApp();
    }

    initializeApp() {
        this.setupEventListeners();
        this.initializeSocket();
    }

    initializeSocket() {
        this.socket = io();
        
        this.socket.on('cities-list', (cities) => {
            this.renderCities(cities);
        });

        this.socket.on('waiting-for-partner', () => {
            this.showScreen('waitingScreen');
        });

        this.socket.on('partner-found', (data) => {
            this.partnerData = data.partnerData;
            this.startVideoCall(data.partnerId);
        });

        this.socket.on('users-in-room', (count) => {
            document.getElementById('usersCount').textContent = count;
        });

        this.socket.on('webrtc-offer', async (data) => {
            await this.handleOffer(data.sdp, data.sender);
        });

        this.socket.on('webrtc-answer', async (data) => {
            await this.handleAnswer(data.sdp);
        });

        this.socket.on('ice-candidate', async (data) => {
            await this.handleIceCandidate(data.candidate);
        });

        this.socket.on('partner-disconnected', () => {
            this.handlePartnerDisconnected();
        });

        this.socket.on('new-message', (data) => {
            this.displayMessage(data, 'partner');
        });
    }

    setupEventListeners() {
        // Кнопка отмены поиска
        document.getElementById('cancelSearch').addEventListener('click', () => {
            this.showScreen('citySelection');
            if (this.socket) {
                this.socket.emit('leave-city');
            }
        });

        // Управление видео/аудио
        document.getElementById('muteAudio').addEventListener('click', this.toggleAudio.bind(this));
        document.getElementById('muteVideo').addEventListener('click', this.toggleVideo.bind(this));
        document.getElementById('nextPartner').addEventListener('click', this.nextPartner.bind(this));
        document.getElementById('hangUp').addEventListener('click', this.hangUp.bind(this));

        // Чат
        document.getElementById('sendMessage').addEventListener('click', this.sendMessage.bind(this));
        document.getElementById('messageInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.sendMessage();
            }
        });
    }

    renderCities(cities) {
        const grid = document.getElementById('citiesGrid');
        grid.innerHTML = '';
        
        cities.forEach(city => {
            const button = document.createElement('button');
            button.className = 'city-btn';
            button.textContent = city;
            button.addEventListener('click', () => this.joinCity(city));
            grid.appendChild(button);
        });
    }

    async joinCity(city) {
        const name = document.getElementById('userName').value.trim();
        const age = document.getElementById('userAge').value;
        const gender = document.getElementById('userGender').value;

        if (!name || !age || !gender) {
            this.showError('Пожалуйста, заполните все поля');
            return;
        }

        if (age < 18) {
            this.showError('Вам должно быть не менее 18 лет');
            return;
        }

        this.currentCity = city;
        this.userData = { name, age: parseInt(age), gender };

        try {
            await this.initializeMedia();
            this.socket.emit('join-city', {
                city: city,
                userData: this.userData
            });
        } catch (error) {
            this.showError('Ошибка доступа к камере/микрофону');
            console.error('Media error:', error);
        }
    }

    async initializeMedia() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = this.localStream;
        } catch (error) {
            throw new Error('Media access denied');
        }
    }

    async startVideoCall(partnerId) {
        this.showScreen('videoChat');
        this.updatePartnerInfo();
        
        await this.createPeerConnection();
        this.addLocalTracks();
        
        // Создаем offer если мы инициатор
        if (this.socket.id < partnerId) {
            await this.createOffer();
        }
    }

    async createPeerConnection() {
        const configuration = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };

        this.peerConnection = new RTCPeerConnection(configuration);

        // Обработка удаленного потока
        this.peerConnection.ontrack = (event) => {
            const remoteVideo = document.getElementById('remoteVideo');
            if (event.streams && event.streams[0]) {
                remoteVideo.srcObject = event.streams[0];
                this.remoteStream = event.streams[0];
            }
        };

        // Обработка ICE кандидатов
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.emit('ice-candidate', {
                    target: this.partnerData.partnerId,
                    candidate: event.candidate
                });
            }
        };

        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
        };
    }

    addLocalTracks() {
        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
        });
    }

    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('webrtc-offer', {
                target: this.partnerData.partnerId,
                sdp: offer
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    async handleOffer(offer, sender) {
        await this.createPeerConnection();
        this.addLocalTracks();
        
        try {
            await this.peerConnection.setRemoteDescription(offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('webrtc-answer', {
                target: sender,
                sdp: answer
            });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(answer);
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(candidate) {
        try {
            await this.peerConnection.addIceCandidate(candidate);
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    toggleAudio() {
        if (this.localStream) {
            const audioTrack = this.localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                const button = document.getElementById('muteAudio');
                button.textContent = audioTrack.enabled ? '🔊' : '🔇';
            }
        }
    }

    toggleVideo() {
        if (this.localStream) {
            const videoTrack = this.localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                const button = document.getElementById('muteVideo');
                button.textContent = videoTrack.enabled ? '📹' : '❌';
            }
        }
    }

    nextPartner() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        this.socket.emit('next-partner');
        this.showScreen('waitingScreen');
        this.clearChat();
    }

    hangUp() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
        
        this.showScreen('citySelection');
        this.clearChat();
    }

    sendMessage() {
        const input = document.getElementById('messageInput');
        const text = input.value.trim();
        
        if (text && this.partnerData) {
            this.socket.emit('send-message', { text });
            this.displayMessage({
                text: text,
                sender: this.userData.name,
                timestamp: new Date().toLocaleTimeString()
            }, 'own');
            
            input.value = '';
        }
    }

    displayMessage(data, type) {
        const messagesContainer = document.getElementById('chatMessages');
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        messageDiv.innerHTML = `
            <div class="message-sender">${data.sender}</div>
            <div class="message-text">${data.text}</div>
            <div class="message-time">${data.timestamp}</div>
        `;
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    clearChat() {
        document.getElementById('chatMessages').innerHTML = '';
    }

    updatePartnerInfo() {
        if (this.partnerData) {
            const info = `${this.partnerData.name}, ${this.partnerData.age}`;
            document.getElementById('partnerInfo').textContent = info;
            document.getElementById('partnerLabel').textContent = this.partnerData.name;
        }
    }

    handlePartnerDisconnected() {
        alert('Партнер отключился');
        this.nextPartner();
    }

    showScreen(screenId) {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
        document.getElementById(screenId).classList.add('active');
    }

    showError(message) {
        const errorDiv = document.getElementById('formError');
        errorDiv.textContent = message;
        setTimeout(() => {
            errorDiv.textContent = '';
        }, 3000);
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new VideoChatApp();
});