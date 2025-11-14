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
        // Подключаемся к серверу
        this.socket = io(window.location.origin);
        
        this.socket.on('connect', () => {
            console.log('Connected to server:', this.socket.id);
        });

        this.socket.on('cities-list', (cities) => {
            this.renderCities(cities);
        });

        this.socket.on('waiting-for-partner', () => {
            this.showScreen('waitingScreen');
        });

        this.socket.on('partner-found', async (data) => {
            console.log('Partner found:', data);
            this.partnerData = data;
            await this.startVideoCall(data.partnerId);
        });

        this.socket.on('users-in-room', (count) => {
            document.getElementById('usersCount').textContent = count;
        });

        this.socket.on('webrtc-offer', async (data) => {
            console.log('Received offer from:', data.sender);
            await this.handleOffer(data.sdp, data.sender);
        });

        this.socket.on('webrtc-answer', async (data) => {
            console.log('Received answer from:', data.sender);
            await this.handleAnswer(data.sdp);
        });

        this.socket.on('ice-candidate', async (data) => {
            console.log('Received ICE candidate from:', data.sender);
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
        document.getElementById('cancelSearch').addEventListener('click', () => {
            this.hangUp();
        });

        document.getElementById('muteAudio').addEventListener('click', this.toggleAudio.bind(this));
        document.getElementById('muteVideo').addEventListener('click', this.toggleVideo.bind(this));
        document.getElementById('nextPartner').addEventListener('click', this.nextPartner.bind(this));
        document.getElementById('hangUp').addEventListener('click', this.hangUp.bind(this));

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

        if (age < 18 || age > 99) {
            this.showError('Вам должно быть от 18 до 99 лет');
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
            this.showError('Ошибка доступа к камере/микрофону. Разрешите доступ и обновите страницу.');
            console.error('Media error:', error);
        }
    }

    async initializeMedia() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    frameRate: { ideal: 30 }
                },
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            
            const localVideo = document.getElementById('localVideo');
            localVideo.srcObject = this.localStream;
            
            console.log('Media initialized successfully');
        } catch (error) {
            console.error('Error accessing media devices:', error);
            throw error;
        }
    }

    async startVideoCall(partnerId) {
        this.showScreen('videoChat');
        this.updatePartnerInfo();
        
        await this.createPeerConnection();
        this.addLocalTracks();
        
        // Создаем offer
        await this.createOffer();
    }

    async createPeerConnection() {
        try {
            const configuration = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ],
                iceCandidatePoolSize: 10
            };

            this.peerConnection = new RTCPeerConnection(configuration);

            // Обработка удаленного потока
            this.peerConnection.ontrack = (event) => {
                console.log('Received remote track:', event);
                const remoteVideo = document.getElementById('remoteVideo');
                if (event.streams && event.streams[0]) {
                    remoteVideo.srcObject = event.streams[0];
                    this.remoteStream = event.streams[0];
                    console.log('Remote video stream set');
                }
            };

            // Обработка ICE кандидатов
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate && this.partnerData) {
                    console.log('Sending ICE candidate');
                    this.socket.emit('ice-candidate', {
                        target: this.partnerData.partnerId,
                        candidate: event.candidate
                    });
                }
            };

            this.peerConnection.oniceconnectionstatechange = () => {
                console.log('ICE connection state:', this.peerConnection.iceConnectionState);
            };

            this.peerConnection.onconnectionstatechange = () => {
                console.log('Connection state:', this.peerConnection.connectionState);
            };

            this.peerConnection.onsignalingstatechange = () => {
                console.log('Signaling state:', this.peerConnection.signalingState);
            };

        } catch (error) {
            console.error('Error creating peer connection:', error);
        }
    }

    addLocalTracks() {
        if (!this.localStream) {
            console.error('No local stream available');
            return;
        }

        this.localStream.getTracks().forEach(track => {
            this.peerConnection.addTrack(track, this.localStream);
            console.log('Added local track:', track.kind);
        });
    }

    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer({
                offerToReceiveAudio: true,
                offerToReceiveVideo: true
            });
            
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('webrtc-offer', {
                target: this.partnerData.partnerId,
                sdp: offer
            });
            
            console.log('Offer created and sent');
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }

    async handleOffer(offer, sender) {
        try {
            if (!this.peerConnection) {
                await this.createPeerConnection();
                this.addLocalTracks();
            }
            
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
            console.log('Remote description set (offer)');
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('webrtc-answer', {
                target: sender,
                sdp: answer
            });
            
            console.log('Answer created and sent');
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }

    async handleAnswer(answer) {
        try {
            if (!this.peerConnection) {
                console.error('No peer connection for answer');
                return;
            }
            
            await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
            console.log('Remote description set (answer)');
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }

    async handleIceCandidate(candidate) {
        try {
            if (!this.peerConnection) {
                console.error('No peer connection for ICE candidate');
                return;
            }
            
            await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
            console.log('ICE candidate added');
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }

    toggleAudio() {
        if (this.localStream) {
            const audioTracks = this.localStream.getAudioTracks();
            if (audioTracks.length > 0) {
                const audioTrack = audioTracks[0];
                audioTrack.enabled = !audioTrack.enabled;
                const button = document.getElementById('muteAudio');
                button.textContent = audioTrack.enabled ? '🔊' : '🔇';
                console.log('Audio toggled:', audioTrack.enabled);
            }
        }
    }

    toggleVideo() {
        if (this.localStream) {
            const videoTracks = this.localStream.getVideoTracks();
            if (videoTracks.length > 0) {
                const videoTrack = videoTracks[0];
                videoTrack.enabled = !videoTrack.enabled;
                const button = document.getElementById('muteVideo');
                button.textContent = videoTrack.enabled ? '📹' : '❌';
                console.log('Video toggled:', videoTrack.enabled);
            }
        }
    }

    nextPartner() {
        console.log('Switching to next partner');
        this.cleanupPeerConnection();
        this.socket.emit('next-partner');
        this.showScreen('waitingScreen');
        this.clearChat();
    }

    hangUp() {
        console.log('Hanging up');
        this.cleanupPeerConnection();
        this.showScreen('citySelection');
        this.clearChat();
        
        // Останавливаем локальный поток
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    }

    cleanupPeerConnection() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
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
        if (this.partnerData && this.partnerData.partnerData) {
            const info = `${this.partnerData.partnerData.name}, ${this.partnerData.partnerData.age}`;
            document.getElementById('partnerInfo').textContent = info;
            document.getElementById('partnerLabel').textContent = this.partnerData.partnerData.name;
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
        }, 5000);
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new VideoChatApp();
});