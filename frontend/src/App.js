import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { Play, Users, Radio, CloudUpload } from 'lucide-react';

const SOCKET_URL = process.env.REACT_APP_SERVER_URL || "http://localhost:3000";
const socket = io(SOCKET_URL);

function App() {
  const [room, setRoom] = useState("");
  const [joined, setJoined] = useState(false);
  const [role, setRole] = useState("");
  const [queue, setQueue] = useState([]);
  const [syncColor, setSyncColor] = useState("bg-green-400");

  const audioCtx = useRef(null);
  const source = useRef(null);
  const buffer = useRef(null);
  const serverOffset = useRef(0);
  const localStartAt = useRef(null);
  const canvasRef = useRef(null);

  useEffect(() => {
    const sync = () => {
      const t0 = Date.now();
      socket.emit("getServerTime");
      socket.once("serverTime", (sTime) => {
        serverOffset.current = sTime + (Date.now() - t0) / 2 - Date.now();
      });
    };
    sync();
    const interval = setInterval(sync, 30000);

    socket.on("role", data => setRole(data.isHost ? "HOST" : "LISTENER"));
    socket.on("queueUpdate", q => setQueue(q));
    
    socket.on("preloadTrack", async (url) => {
      const res = await fetch(url);
      const arr = await res.arrayBuffer();
      buffer.current = await audioCtx.current.decodeAudioData(arr);
      socket.emit("clientReady", room);
    });

    socket.on("startPlayback", (startTime) => {
      if (source.current) source.current.stop();
      source.current = audioCtx.current.createBufferSource();
      source.current.buffer = buffer.current;
      
      const analyser = audioCtx.current.createAnalyser();
      analyser.fftSize = 128;
      source.current.connect(analyser).connect(audioCtx.current.destination);
      
      const serverNow = Date.now() + serverOffset.current;
      const audioStart = audioCtx.current.currentTime + (startTime - serverNow) / 1000;

      audioStart < audioCtx.current.currentTime 
        ? source.current.start(0, audioCtx.current.currentTime - audioStart)
        : source.current.start(audioStart);
      
      localStartAt.current = audioStart < audioCtx.current.currentTime ? audioCtx.current.currentTime - (audioCtx.current.currentTime - audioStart) : audioStart;
      startVisualizer(analyser);
    });

    socket.on("syncPosition", data => {
      if (!localStartAt.current) return;
      const drift = ((Date.now() + serverOffset.current - data.startedAt) / 1000) - (audioCtx.current.currentTime - localStartAt.current);
      if (Math.abs(drift) > 0.05) {
        setSyncColor(Math.abs(drift) > 0.2 ? "bg-red-500" : "bg-yellow-500");
        if(source.current) source.current.playbackRate.value = drift > 0 ? 1.01 : 0.99;
      } else {
        setSyncColor("bg-green-400");
        if(source.current) source.current.playbackRate.value = 1.0;
      }
    });

    return () => { clearInterval(interval); socket.off(); };
  }, [room]);

  const startVisualizer = (analyser) => {
    const ctx = canvasRef.current.getContext("2d");
    const data = new Uint8Array(analyser.frequencyBinCount);
    const render = () => {
      requestAnimationFrame(render);
      analyser.getByteFrequencyData(data);
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      data.forEach((v, i) => {
        ctx.fillStyle = `rgba(168, 85, 247, ${v/255})`;
        ctx.fillRect(i * 10, 60 - v/4, 8, v/4);
      });
    };
    render();
  };

  const join = () => {
    if (!audioCtx.current) audioCtx.current = new AudioContext();
    audioCtx.current.resume();
    socket.emit("joinRoom", room);
    setJoined(true);
  };

  const upload = async (e) => {
    const formData = new FormData();
    formData.append("song", e.target.files[0]);
    const res = await fetch(`${SOCKET_URL}/upload`, { method: "POST", body: formData });
    const data = await res.json();
    socket.emit("addToQueue", { room, trackUrl: data.url });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans">
      {!joined ? (
        <div className="w-full max-w-md bg-slate-900/50 border border-slate-800 p-10 rounded-[2rem] backdrop-blur-3xl shadow-2xl">
          <h1 className="text-4xl font-black italic tracking-tighter mb-8 text-center bg-gradient-to-br from-white to-slate-500 bg-clip-text text-transparent">SYNC.WAVE</h1>
          <input className="w-full bg-slate-800 border-none rounded-2xl p-4 mb-4 focus:ring-2 focus:ring-purple-500 transition-all" placeholder="Enter Room Name" onChange={e => setRoom(e.target.value)} />
          <button onClick={join} className="w-full bg-purple-600 hover:bg-purple-500 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 transition-all active:scale-95 shadow-lg shadow-purple-500/20"><Radio size={20}/> JOIN SESSION</button>
        </div>
      ) : (
        <div className="w-full max-w-2xl bg-slate-900/40 border border-white/5 p-8 rounded-[3rem] backdrop-blur-2xl space-y-8 relative">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className={`w-3 h-3 rounded-full ${syncColor} animate-pulse shadow-lg`}></div>
              <span className="text-[10px] font-bold tracking-[0.2em] opacity-40 uppercase">{role} MODE</span>
            </div>
            <Users size={18} className="opacity-30" />
          </div>

          <canvas ref={canvasRef} width="400" height="60" className="w-full opacity-60" />

          {role === "HOST" && (
            <div className="grid grid-cols-1 gap-4">
              <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-slate-800 rounded-3xl hover:bg-white/5 transition-colors cursor-pointer group">
                <CloudUpload className="mb-2 opacity-20 group-hover:opacity-100 transition-opacity" />
                <span className="text-xs opacity-30">Drop or Click to Upload MP3</span>
                <input type="file" className="hidden" onChange={upload} accept="audio/*" />
              </label>
              <button onClick={() => socket.emit("playNext", room)} className="bg-white text-slate-950 py-4 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-slate-200 transition-colors"><Play size={18}/> START NEXT TRACK</button>
            </div>
          )}

          <div className="bg-black/20 rounded-3xl p-6 border border-white/5">
            <h3 className="text-[10px] font-black uppercase tracking-widest opacity-20 mb-4">Current Queue</h3>
            <div className="space-y-3">
              {queue.map((s, i) => (
                <div key={i} className="flex items-center gap-4 text-sm opacity-80 animate-in slide-in-from-left-4">
                  <span className="text-purple-500 font-mono">0{i+1}</span>
                  <span className="truncate">{s.split('/').pop()}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
