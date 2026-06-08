import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LoadingState({ message = 'Loading\u2026' }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground p-6">
      <Loader2 className="animate-spin size-4" />
      <span>{message}</span>
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="p-6 text-destructive space-y-2">
      <p>{message}</p>
      {onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}
    </div>
  );
}
