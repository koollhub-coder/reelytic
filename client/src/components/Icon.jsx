import React from 'react';
import {
  Sun,
  Moon,
  Menu,
  Copy,
  Check,
  Eye,
  EyeOff,
  Lock,
  X,
  Pencil,
  Info,
  Link2,
  Download,
  ChevronDown,
  ArrowLeft,
  ArrowUpRight,
  Trash2,
  Plus,
  Search,
  RotateCcw,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Share2,
  Clapperboard,
  User,
} from 'lucide-react';

/*
  The project's icon set.

  These were hand-drawn SVG paths for a while, and it showed: the glyphs were
  not on a shared grid, their optical sizes disagreed with one another, and
  the stroke weight was fixed so small icons looked heavy and large ones
  looked thin. Drawing an icon set by eye is a specialist job and there is no
  reason to do it here.

  This is Lucide (lucide.dev, ISC licensed, the successor to Feather and the
  set shadcn/ui ships with). Every glyph is drawn on the same 24px grid with
  the same joins and terminals, which is exactly the consistency that was
  missing. Tree-shaken by Vite, so only the icons imported here reach the
  bundle.

  Wrapped rather than re-exported directly so the whole app keeps a single
  place to set defaults, and so call sites keep the ...Icon names they already
  use.
*/

// 1.75 reads slightly lighter than Lucide's default 2 and sits better against
// this app's type, which is not especially heavy. Overridable per icon.
const DEFAULT_STROKE = 1.75;

function make(LucideIcon, displayName) {
  const Wrapped = ({ size = 16, strokeWidth = DEFAULT_STROKE, label, style, ...rest }) => (
    <LucideIcon
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      /*
        display:block stops the glyph inheriting its button's line-height and
        sitting a pixel low, which is the usual reason an icon looks
        slightly off-centre next to text. shrink-0 keeps it from being
        squashed inside a flex row.
      */
      style={{ flexShrink: 0, display: 'block', ...style }}
      {...rest}
    />
  );
  Wrapped.displayName = displayName;
  return Wrapped;
}

export const SunIcon = make(Sun, 'SunIcon');
export const MoonIcon = make(Moon, 'MoonIcon');
export const MenuIcon = make(Menu, 'MenuIcon');
export const CopyIcon = make(Copy, 'CopyIcon');
export const CheckIcon = make(Check, 'CheckIcon');
export const EyeIcon = make(Eye, 'EyeIcon');
export const EyeOffIcon = make(EyeOff, 'EyeOffIcon');
export const LockIcon = make(Lock, 'LockIcon');
export const XIcon = make(X, 'XIcon');
export const PencilIcon = make(Pencil, 'PencilIcon');
export const InfoIcon = make(Info, 'InfoIcon');
export const LinkIcon = make(Link2, 'LinkIcon');
export const DownloadIcon = make(Download, 'DownloadIcon');
export const ChevronDownIcon = make(ChevronDown, 'ChevronDownIcon');
export const ArrowLeftIcon = make(ArrowLeft, 'ArrowLeftIcon');
export const ArrowUpRightIcon = make(ArrowUpRight, 'ArrowUpRightIcon');
export const TrashIcon = make(Trash2, 'TrashIcon');
export const PlusIcon = make(Plus, 'PlusIcon');
export const SearchIcon = make(Search, 'SearchIcon');
export const ReplayIcon = make(RotateCcw, 'ReplayIcon');
export const ExternalLinkIcon = make(ExternalLink, 'ExternalLinkIcon');
export const WarningIcon = make(AlertTriangle, 'WarningIcon');
export const SuccessIcon = make(CheckCircle2, 'SuccessIcon');
export const SpreadsheetIcon = make(FileSpreadsheet, 'SpreadsheetIcon');
export const ShareIcon = make(Share2, 'ShareIcon');
export const ReelIcon = make(Clapperboard, 'ReelIcon');
export const ProfileIcon = make(User, 'ProfileIcon');
