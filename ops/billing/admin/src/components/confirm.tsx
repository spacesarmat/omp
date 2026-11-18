import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/modal';

type Ask = {
  title: string;
  body: string;
  yes: string;
  resolve: (ok: boolean) => void;
};

let openAsk: ((ask: Ask) => void) | null = null;

/** One question for a destructive action. Resolves false when the host is missing or the person cancels. */
export function askConfirm(req: { title: string; body: string; yes?: string }) {
  return new Promise<boolean>((resolve) => {
    if (!openAsk) {
      resolve(false);
      return;
    }
    openAsk({ title: req.title, body: req.body, yes: req.yes || 'Да', resolve });
  });
}

export function ConfirmHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  useEffect(() => {
    openAsk = (next) => setAsk(next);
    return () => {
      openAsk = null;
    };
  }, []);
  if (!ask) return null;
  const close = (ok: boolean) => {
    const done = ask.resolve;
    setAsk(null);
    done(ok);
  };
  return (
    <Modal title={ask.title} onClose={() => close(false)}>
      <div className="space-y-4 p-4">
        <p className="text-sm">{ask.body}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" onClick={() => close(true)}>
            {ask.yes}
          </Button>
          <Button variant="secondary" onClick={() => close(false)}>
            Отмена
          </Button>
        </div>
      </div>
    </Modal>
  );
}
