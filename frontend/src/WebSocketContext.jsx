import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { setAuthToken } from './api';

const WSContext = createContext(null);

export function WSProvider({ children }) {
  const [connected, setConnected] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [lastNotification, setLastNotification] = useState(null);
  const [lastChatMessage, setLastChatMessage] = useState(null);
  const [lastDeletedMessage, setLastDeletedMessage] = useState(null);
  const [lastDocumentEvent, setLastDocumentEvent] = useState(null);
  const wsRef = useRef(null);
  const tokenRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback((token) => {
    tokenRef.current = token;
    if (wsRef.current) wsRef.current.close();

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const ws = new WebSocket(`${protocol}//${host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case 'auth_ok':
            setConnected(true);
            if (msg.userId) {
              setOnlineUsers(prev => {
                const id = String(msg.userId);
                if (prev.some(u => String(u.userId) === id)) return prev;
                return [...prev, { userId: msg.userId, username: msg.username || '', role: msg.role || '' }];
              });
            }
            break;
          case 'user_online':
            setOnlineUsers(prev => {
              const exists = prev.find(u => String(u.userId) === String(msg.userId));
              if (exists) return prev;
              return [...prev, { userId: msg.userId, username: msg.username, role: msg.role }];
            });
            break;
          case 'user_offline':
            setOnlineUsers(prev => prev.filter(u => String(u.userId) !== String(msg.userId)));
            break;
          case 'notification':
            setLastNotification(msg);
            break;
          case 'chat_message':
            setLastChatMessage(msg.message || msg);
            break;
          case 'chat_message_deleted':
            setLastDeletedMessage(msg);
            break;
          case 'document_snapshot':
          case 'document_updated':
          case 'document_conflict':
            setLastDocumentEvent({ ...msg, received_at: Date.now() });
            break;
          case 'session_revoked':
            tokenRef.current = null;
            setAuthToken(null);
            window.dispatchEvent(new CustomEvent('auth:revoked', { detail: msg.reason }));
            window.location.hash = '#login';
            window.setTimeout(() => window.location.reload(), 50);
            break;
          case 'pong':
            break;
        }
      } catch {}
    };

    ws.onclose = () => {
      setConnected(false);
      setTimeout(() => {
        if (tokenRef.current) reconnectRef.current?.(tokenRef.current);
      }, 3000);
    };

    ws.onerror = () => {};
  }, []);

  useEffect(() => {
    reconnectRef.current = connect;
  }, [connect]);

  const disconnect = useCallback(() => {
    tokenRef.current = null;
    if (wsRef.current) wsRef.current.close();
    wsRef.current = null;
    setConnected(false);
    setOnlineUsers([]);
  }, []);

  const send = useCallback((data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    return () => { disconnect(); };
  }, [disconnect]);

  return (
    <WSContext.Provider value={{ connected, onlineUsers, lastNotification, lastChatMessage, lastDeletedMessage, lastDocumentEvent, connect, disconnect, send }}>
      {children}
    </WSContext.Provider>
  );
}

export function useWS() {
  const ctx = useContext(WSContext);
  if (!ctx) throw new Error('useWS must be used within WSProvider');
  return ctx;
}
