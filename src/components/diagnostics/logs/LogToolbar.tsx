import { Copy, Download, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  onCopy?: () => void;
  onDownload?: () => void;
  onClear?: () => void;
  copyLabel?: string;
  extra?: React.ReactNode;
};

export function LogToolbar({
  onCopy,
  onDownload,
  onClear,
  copyLabel = 'Copy',
  extra,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {extra}
      {onCopy && (
        <Button type="button" size="sm" variant="ghost" onClick={onCopy}>
          <Copy className="w-3 h-3 mr-1" />
          {copyLabel}
        </Button>
      )}
      {onDownload && (
        <Button type="button" size="sm" variant="ghost" onClick={onDownload}>
          <Download className="w-3 h-3 mr-1" />
          Download
        </Button>
      )}
      {onClear && (
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          <Trash2 className="w-3 h-3 mr-1" />
          Clear
        </Button>
      )}
    </div>
  );
}
