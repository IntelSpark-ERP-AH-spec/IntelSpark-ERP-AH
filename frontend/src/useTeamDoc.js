import { useCallback, useEffect, useRef, useState } from 'react';
import { useWS } from './WebSocketContext';

export function useTeamDoc(key, initialValue) {
  const { connected, lastDocumentEvent, send } = useWS();
  const [data, setData] = useState(initialValue);
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);
  const dataRef = useRef(initialValue);
  const versionRef = useRef(0);

  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { versionRef.current = version; }, [version]);

  useEffect(() => {
    if (!connected) return undefined;
    send({ type: 'document_subscribe', key });
    return () => send({ type: 'document_unsubscribe', key });
  }, [connected, key, send]);

  useEffect(() => {
    if (!lastDocumentEvent || lastDocumentEvent.key !== key) return;
    if (lastDocumentEvent.type === 'document_snapshot' || lastDocumentEvent.type === 'document_updated') {
      const nextValue = lastDocumentEvent.value === null ? initialValue : lastDocumentEvent.value;
      setData(nextValue);
      setVersion(Number(lastDocumentEvent.version || 0));
      setLoaded(true);
      setSaving(false);
      setConflict(null);
      return;
    }
    if (lastDocumentEvent.type === 'document_conflict') {
      setConflict({
        remoteValue: lastDocumentEvent.value,
        remoteVersion: Number(lastDocumentEvent.version || 0),
        localValue: dataRef.current,
      });
      setSaving(false);
    }
  }, [lastDocumentEvent, key, initialValue]);

  const update = useCallback((nextValueOrUpdater) => {
    const nextValue = typeof nextValueOrUpdater === 'function'
      ? nextValueOrUpdater(dataRef.current)
      : nextValueOrUpdater;
    dataRef.current = nextValue;
    setData(nextValue);
    setSaving(true);
    send({
      type: 'document_update',
      key,
      value: nextValue,
      expected_version: versionRef.current,
    });
  }, [key, send]);

  const acceptRemote = useCallback(() => {
    if (!conflict) return;
    dataRef.current = conflict.remoteValue;
    versionRef.current = conflict.remoteVersion;
    setData(conflict.remoteValue);
    setVersion(conflict.remoteVersion);
    setConflict(null);
  }, [conflict]);

  const overwriteRemote = useCallback(() => {
    if (!conflict) return;
    setSaving(true);
    send({
      type: 'document_update',
      key,
      value: conflict.localValue,
      expected_version: conflict.remoteVersion,
    });
  }, [conflict, key, send]);

  return {
    data,
    version,
    loaded,
    saving,
    connected,
    conflict,
    setData: update,
    acceptRemote,
    overwriteRemote,
  };
}
