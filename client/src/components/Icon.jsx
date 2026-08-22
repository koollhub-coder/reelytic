import React from 'react';
import {
  SunMedium,
  MoonStar,
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
  Play,
  Settings2,
  FileText,
  Layers,
  GripVertical,
  Clock,
  TrendingUp,
  TrendingDown,
  LayoutDashboard,
  History,
  HelpCircle,
  CreditCard,
  Users,
  ClipboardList,
  Receipt,
  Tag,
  BarChart3,
  SlidersHorizontal,
  Activity,
  MoreVertical,
  Shield,
  BookOpen,
  Palette,
  Calendar,
  Star,
  LayoutGrid,
  Upload,
  CloudUpload,
  ArrowRight,
  Loader2,
  Mail,
  Zap,
  Gift,
  Package,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
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

// SunMedium/MoonStar instead of the bare Sun/Moon glyphs -- the plain
// circle-with-spokes Sun and the plain crescent Moon read as clip-art next
// to the rest of this icon set; the "Medium"/"Star" variants have finer
// linework at 16-18px and are what most polished SaaS theme toggles
// actually ship (Vercel, Linear). Wrapped once here, so every call site
// (Shell's sidebar/topbar, Landing's nav/mobile menu) picks it up for free.
export const SunIcon = make(SunMedium, 'SunIcon');
export const MoonIcon = make(MoonStar, 'MoonIcon');
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
export const PlayIcon = make(Play, 'PlayIcon');
export const SettingsIcon = make(Settings2, 'SettingsIcon');
export const FileIcon = make(FileText, 'FileIcon');
export const LayersIcon = make(Layers, 'LayersIcon');
export const GripIcon = make(GripVertical, 'GripIcon');
export const ClockIcon = make(Clock, 'ClockIcon');
export const TrendingUpIcon = make(TrendingUp, 'TrendingUpIcon');
export const TrendingDownIcon = make(TrendingDown, 'TrendingDownIcon');
export const DashboardIcon = make(LayoutDashboard, 'DashboardIcon');
export const HistoryIcon = make(History, 'HistoryIcon');
export const HelpIcon = make(HelpCircle, 'HelpIcon');
export const CreditCardIcon = make(CreditCard, 'CreditCardIcon');
export const UsersIcon = make(Users, 'UsersIcon');
export const ListIcon = make(ClipboardList, 'ListIcon');
export const ReceiptIcon = make(Receipt, 'ReceiptIcon');
export const TagIcon = make(Tag, 'TagIcon');
export const ChartIcon = make(BarChart3, 'ChartIcon');
export const SlidersIcon = make(SlidersHorizontal, 'SlidersIcon');
export const ActivityIcon = make(Activity, 'ActivityIcon');
export const MoreIcon = make(MoreVertical, 'MoreIcon');
export const ShieldIcon = make(Shield, 'ShieldIcon');
export const TourIcon = make(BookOpen, 'TourIcon');
export const PaletteIcon = make(Palette, 'PaletteIcon');
export const CalendarIcon = make(Calendar, 'CalendarIcon');
export const StarIcon = make(Star, 'StarIcon');
export const GridIcon = make(LayoutGrid, 'GridIcon');
export const UploadIcon = make(Upload, 'UploadIcon');
export const CloudUploadIcon = make(CloudUpload, 'CloudUploadIcon');
export const ArrowRightIcon = make(ArrowRight, 'ArrowRightIcon');
export const LoaderIcon = make(Loader2, 'LoaderIcon');
export const MailIcon = make(Mail, 'MailIcon');
export const ZapIcon = make(Zap, 'ZapIcon');
export const GiftIcon = make(Gift, 'GiftIcon');
export const PackageIcon = make(Package, 'PackageIcon');
export const SparkleIcon = make(Sparkles, 'SparkleIcon');
export const SidebarCollapseIcon = make(PanelLeftClose, 'SidebarCollapseIcon');
export const SidebarExpandIcon = make(PanelLeftOpen, 'SidebarExpandIcon');

/*
  Lucide dropped every trademarked brand/logo glyph (Instagram, LinkedIn,
  Twitter, etc) some versions back -- this project's 1.31.0 has none of
  them. These three are minimal hand-drawn outlines instead of a new
  dependency for three static, non-interactive footer marks (see
  Landing.jsx's own note on why they're not links yet). "Twitter" reuses the
  plain X glyph already defined above -- since the platform's own rebrand,
  that IS the mark, so there's nothing to hand-draw.
*/
export const InstagramIcon = ({ size = 16, style, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block', ...style }} aria-hidden="true" {...rest}>
    <rect x="3" y="3" width="18" height="18" rx="5" />
    <circle cx="12" cy="12" r="4.2" />
    <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);
export const LinkedinIcon = ({ size = 16, style, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, display: 'block', ...style }} aria-hidden="true" {...rest}>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <line x1="7.5" y1="10.5" x2="7.5" y2="16.5" />
    <circle cx="7.5" cy="7" r="0.9" fill="currentColor" stroke="none" />
    <path d="M11.5 16.5v-4c0-1.4 1-2.3 2.2-2.3 1.3 0 2.1 1 2.1 2.4v3.9" />
  </svg>
);
export const TwitterIcon = XIcon;

/*
  A real "this is an Excel file" mark -- SpreadsheetIcon (lucide's
  FileSpreadsheet) is a generic gray document-with-grid glyph that reads as
  "some kind of table," not specifically Excel, which was the whole point of
  showing it next to a .xlsx filename. This is Excel-green (#217346, the same
  green Microsoft's own icon uses) with white gridlines -- unambiguous at a
  glance without redrawing Microsoft's actual trademarked logo mark, the same
  restraint used for the Instagram/LinkedIn glyphs above. Not wrapped in
  make() since it's intentionally NOT currentColor -- unlike every other icon
  in this set, it should always render Excel-green regardless of the
  surrounding tone/theme, the same way a real file-type icon would.
*/
export const ExcelIcon = ({ size = 16, style, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ flexShrink: 0, display: 'block', ...style }} aria-hidden="true" {...rest}>
    {/* A document with a folded corner and a spreadsheet grid -- the shape
        every OS/file-manager uses for "this is a table file," rather than
        a plain X-in-a-box, which read as a generic close/error icon
        instead of anything to do with spreadsheets. */}
    <path d="M6 2.5h8.5L19 7v13a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 20V4a1.5 1.5 0 0 1 1-1.5z" fill="#1F9D6B" stroke="#1F9D6B" strokeWidth="1" strokeLinejoin="round" />
    <path d="M14.5 2.5V6a1 1 0 0 0 1 1H19" fill="none" stroke="#0F6B47" strokeWidth="1" strokeLinejoin="round" />
    <g stroke="#FFFFFF" strokeWidth="1.1" strokeLinecap="round">
      <path d="M7.7 10.2h8.6M7.7 13.1h8.6M7.7 16h8.6" />
      <path d="M10.8 9.3v7.7M13.2 9.3v7.7" />
    </g>
  </svg>
);
