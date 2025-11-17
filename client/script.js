class AudioChat {
    constructor() {
        this.socket = null;
        this.localStream = null;
        this.remoteStream = null;
        this.peerConnection = null;
        this.partnerData = null;
        this.currentCity = null;
        this.userData = null;
        this.isMuted = false;
        this.audioContext = null;
        this.analyser = null;
        
        this.initializeApp();
    }

    initializeApp() {
        this.setupEventListeners();
        this.initializeSocket();
        console.log('🎤 AudioChat initialized');
    }

    initializeSocket() {
        this.socket = io();
        
        this.socket.on('connect', () => {
            console.log('✅ Connected to server:', this.socket.id);
        });

        this.socket.on('cities-list', (cities) => {
            this.renderCities(cities);
        });

        this.socket.on('waiting-for-partner', () => {
            this.showScreen('waitingScreen');
            this.updateStatus('⏳ Ищем партнера для аудио-чата...');
        });

        this.socket.on('partner-found', async (data) => {
            console.log('🎯 Partner found:', data);
            this.partnerData = data;
            await this.startAudioCall(data.partnerId);
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
    }

    setupEventListeners() {
        document.getElementById('cancelSearch').addEventListener('click', () => {
            this.hangUp();
        });

        document.getElementById('muteAudio').addEventListener('click', () => this.toggleAudio());
        document.getElementById('nextPartner').addEventListener('click', () => this.nextPartner());
        document.getElementById('hangUp').addEventListener('click', () => this.hangUp());
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
            await this.initializeAudio();
            this.socket.emit('join-city', { 
                city: city, 
                userData: this.userData 
            });
            this.updateStatus('✅ Микрофон подключен');
        } catch (error) {
            console.error('Audio error:', error);
            this.showError('Не удалось подключить микрофон. Пожалуйста, разрешите доступ к микрофону.');
        }
    }

    async initializeAudio() {
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1
                },
                video: false
            });
            
            this.createAudioVisualizer();
            console.log('🎤 Microphone access granted');
            return true;
            
        } catch (error) {
            console.error('🎤 Microphone access denied:', error);
            throw error;
        }
    }

    createAudioVisualizer() {
        if (!this.localStream) return;
        
        try {
            this.audioContext = new AudioContext();
            this.analyser = this.audioContext.createAnalyser();
            const source = this.audioContext.createMediaStreamSource(this.localStream);
            source.connect(this.analyser);
            
            this.analyser.fftSize = 256;
            const bufferLength = this.analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            const drawVisualizer = () => {
                if (!this.analyser) return;
                
                this.analyser.getByteFrequencyData(dataArray);
                const volume = dataArray.reduce((a, b) => a + b) / bufferLength;
                this.updateVolumeIndicator(volume, 'local');
                
                requestAnimationFrame(drawVisualizer);
            };
            
            drawVisualizer();
            console.log('📊 Audio visualizer created');
            
        } catch (error) {
            console.error('Visualizer error:', error);
        }
    }

    async startAudioCall(partnerId) {
        this.showScreen('audioChat');
        this.updatePartnerInfo();
        
        await this.createPeerConnection();
        this.addLocalTracks();
        
        // Создаем offer если мы инициаторы
        if (this.socket.id < partnerId) {
            await this.createOffer();
        }
        
        this.updateStatus('🎤 Устанавливаем аудио-соединение...');
    }

    async createPeerConnection() {
        try {
            const configuration = {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            };

            this.peerConnection = new RTCPeerConnection(configuration);

            // Обработка удаленного аудио потока
            this.peerConnection.ontrack = (event) => {
                console.log('🔊 Received remote audio track');
                if (event.streams && event.streams[0]) {
                    this.remoteStream = event.streams[0];
                    
                    // Создаем аудио элемент для воспроизведения
                    const remoteAudio = document.getElementById('remoteAudio');
                    if (remoteAudio) {
                        remoteAudio.srcObject = this.remoteStream;
                        remoteAudio.play().then(() => {
                            console.log('✅ Remote audio playing');
                            this.updateStatus('✅ Аудио-соединение установлено! Говорите!');
                            this.updatePartnerStatus('🔊 Подключен');
                        }).catch(e => {
                            console.error('Remote audio play error:', e);
                            this.updateStatus('❌ Ошибка воспроизведения аудио');
                        });
                    }
                    
                    // Визуализатор для удаленного аудио
                    this.createRemoteAudioVisualizer();
                }
            };

            // ICE кандидаты
            this.peerConnection.onicecandidate = (event) => {
                if (event.candidate && this.partnerData) {
                    this.socket.emit('ice-candidate', {
                        target: this.partnerData.partnerId,
                        candidate: event.candidate
                    });
                }
            };

            this.peerConnection.oniceconnectionstatechange = () => {
                const state = this.peerConnection.iceConnectionState;
                console.log('🔗 ICE connection state:', state);
                
                if (state === 'connected' || state === 'completed') {
                    this.updateStatus('✅ Аудио-соединение установлено!');
                } else if (state === 'failed' || state === 'disconnected') {
                    this.updateStatus('❌ Проблемы с аудио-соединением');
                }
            };

            this.peerConnection.onconnectionstatechange = () => {
                console.log('🔄 Connection state:', this.peerConnection.connectionState);
            };

        } catch (error) {
            console.error('PeerConnection error:', error);
        }
    }

    addLocalTracks() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                this.peerConnection.addTrack(track, this.localStream);
            });
            console.log('✅ Added local audio tracks');
        }
    }

    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer();
            await this.peerConnection.setLocalDescription(offer);
            
            this.socket.emit('webrtc-offer', {
                target: this.partnerData.partnerId,
                sdp: offer
            });
            
            console.log('📨 Offer sent');
        } catch (error) {
            console.error('Offer error:', error);
        }
    }

    async handleOffer(offer, sender) {
        try {
            if (!this.peerConnection) {
                await this.createPeerConnection();
                this.addLocalTracks();
            }
            
            await this.peerConnection.setRemoteDescription(offer);
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            this.socket.emit('webrtc-answer', {
                target: sender,
                sdp: answer
            });
            
            console.log('📨 Answer sent');
        } catch (error) {
            console.error('Handle offer error:', error);
        }
    }

    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(answer);
            console.log('✅ Remote description set');
        } catch (error) {
            console.error('Handle answer error:', error);
        }
    }

    async handleIceCandidate(candidate) {
        try {
            await this.peerConnection.addIceCandidate(candidate);
            console.log('✅ ICE candidate added');
        } catch (error) {
            console.error('ICE candidate error:', error);
        }
    }

    createRemoteAudioVisualizer() {
        if (!this.remoteStream) return;
        
        try {
            const remoteAudioContext = new AudioContext();
            const remoteAnalyser = remoteAudioContext.createAnalyser();
            const remoteSource = remoteAudioContext.createMediaStreamSource(this.remoteStream);
            remoteSource.connect(remoteAnalyser);
            
            remoteAnalyser.fftSize = 256;
            const bufferLength = remoteAnalyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            const drawRemoteVisualizer = () => {
                if (!remoteAnalyser) return;
                
                remoteAnalyser.getByteFrequencyData(dataArray);
                const volume = dataArray.reduce((a, b) => a + b) / bufferLength;
                this.updateVolumeIndicator(volume, 'partner');
                
                // Обновляем статус партнера
                if (volume > 20) {
                    this.updatePartnerStatus('🔊 ГОВОРИТ');
                } else {
                    this.updatePartnerStatus('🎤 Подключен');
                }
                
                requestAnimationFrame(drawRemoteVisualizer);
            };
            
            drawRemoteVisualizer();
            console.log('📊 Remote audio visualizer created');
            
        } catch (error) {
            console.error('Remote visualizer error:', error);
        }
    }

    updateVolumeIndicator(volume, type) {
        const indicator = type === 'local' 
            ? document.getElementById('volumeIndicator')
            : document.getElementById('partnerVolumeIndicator');
            
        if (indicator) {
            const bars = 8;
            const activeBars = Math.min(bars, Math.ceil(volume / 12));
            let indicatorHTML = '';
            
            for (let i = 0; i < bars; i++) {
                if (i < activeBars) {
                    indicatorHTML += '█';
                } else {
                    indicatorHTML += '░';
                }
            }
            
            indicator.textContent = indicatorHTML;
            
            if (volume > 40) {
                indicator.style.color = '#4CAF50';
            } else if (volume > 20) {
                indicator.style.color = '#FF9800';
            } else {
                indicator.style.color = '#f44336';
            }
        }
    }

    updatePartnerStatus(status) {
        const partnerStatus = document.querySelector('.partner-status');
        const partnerCard = document.querySelector('.partner-user');
        
        if (partnerStatus) {
            partnerStatus.textContent = status;
            
            if (status === '🔊 ГОВОРИТ') {
                partnerStatus.style.color = '#4CAF50';
                partnerStatus.style.fontWeight = 'bold';
                if (partnerCard) {
                    partnerCard.style.boxShadow = '0 0 20px #4CAF50';
                }
            } else {
                partnerStatus.style.color = '#667eea';
                partnerStatus.style.fontWeight = 'normal';
                if (partnerCard) {
                    partnerCard.style.boxShadow = '';
                }
            }
        }
    }

    toggleAudio() {
        if (this.localStream) {
            this.isMuted = !this.isMuted;
            this.localStream.getAudioTracks()[0].enabled = !this.isMuted;
            
            const button = document.getElementById('muteAudio');
            const status = document.getElementById('audioStatus');
            
            if (this.isMuted) {
                button.textContent = '🔇';
                button.className = 'control-btn muted';
                if (status) {
                    status.textContent = '🔇 Микрофон выключен';
                    status.className = 'status-muted';
                }
                this.updateStatus('🔇 Микрофон выключен');
            } else {
                button.textContent = '🎤';
                button.className = 'control-btn';
                if (status) {
                    status.textContent = '🔊 Аудио активно';
                    status.className = 'status-active';
                }
                this.updateStatus('🎤 Микрофон включен');
            }
        }
    }

    nextPartner() {
        this.cleanupPeerConnection();
        this.updateStatus('🔄 Ищем нового партнера...');
        this.socket.emit('next-partner');
        this.showScreen('waitingScreen');
    }

    hangUp() {
        this.cleanupPeerConnection();
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
        }
        if (this.audioContext) {
            this.audioContext.close();
        }
        this.showScreen('citySelection');
        this.partnerData = null;
        this.currentCity = null;
        this.updateStatus('📞 Звонок завершен');
    }

    cleanupPeerConnection() {
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        // Останавливаем удаленное аудио
        const remoteAudio = document.getElementById('remoteAudio');
        if (remoteAudio) {
            remoteAudio.srcObject = null;
        }
    }

    updatePartnerInfo() {
        if (this.partnerData && this.partnerData.partnerData) {
            const info = `${this.partnerData.partnerData.name}, ${this.partnerData.partnerData.age}`;
            document.getElementById('partnerInfo').textContent = info;
            document.getElementById('partnerName').textContent = this.partnerData.partnerData.name;
            
            const partnerAvatar = document.getElementById('partnerAvatar');
            if (partnerAvatar) {
                partnerAvatar.textContent = this.partnerData.partnerData.gender === 'female' ? '👩' : '👨';
            }
        }
    }

    handlePartnerDisconnected() {
        this.updateStatus('❌ Партнер отключился');
        this.cleanupPeerConnection();
        
        setTimeout(() => {
            this.nextPartner();
        }, 2000);
    }

    updateStatus(message) {
        const statusElement = document.getElementById('connectionStatus');
        if (statusElement) {
            statusElement.textContent = message;
        }
        console.log('Status:', message);
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
        setTimeout(() => errorDiv.textContent = '', 5000);
    }
}

// Инициализация приложения
document.addEventListener('DOMContentLoaded', () => {
    new AudioChat();
});