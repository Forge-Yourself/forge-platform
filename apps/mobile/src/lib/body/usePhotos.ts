import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { fetchPhotos, type ProgressPhotoRow } from './bodyApi';

export type PhotosData = {
  loading: boolean;
  error: string | null;
  rows: ProgressPhotoRow[];
  refetch: () => void;
};

export function usePhotos(clientId: string | undefined): PhotosData {
  const [state, setState] = useState<{ rows: ProgressPhotoRow[]; loading: boolean; error: string | null }>({
    rows: [],
    loading: true,
    error: null,
  });
  const seq = useRef(0);

  const load = useCallback(() => {
    if (!clientId) return () => {};
    const mine = ++seq.current;
    void fetchPhotos(clientId).then((r) => {
      if (mine === seq.current) setState({ rows: r.rows, loading: false, error: r.error });
    });
    return () => {
      seq.current++;
    };
  }, [clientId]);

  useFocusEffect(load);

  return {
    ...state,
    refetch: () => {
      load();
    },
  };
}
