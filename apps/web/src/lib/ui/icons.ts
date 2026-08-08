/**
 * One place decides which Lucide glyph stands for which idea in this app.
 *
 * Call sites name the concept - `retry`, `playNext`, `bands` - rather than the drawing, so
 * changing a glyph is one line here instead of a search across every component. Deep
 * per-icon imports rather than the barrel, which re-exports every icon Lucide ships.
 */
import AudioLines from 'lucide-svelte/icons/audio-lines';
import Check from 'lucide-svelte/icons/check';
import ChevronDown from 'lucide-svelte/icons/chevron-down';
import ChevronLeft from 'lucide-svelte/icons/chevron-left';
import ChevronRight from 'lucide-svelte/icons/chevron-right';
import ChevronUp from 'lucide-svelte/icons/chevron-up';
import Link from 'lucide-svelte/icons/link';
import ListMusic from 'lucide-svelte/icons/list-music';
import ListPlus from 'lucide-svelte/icons/list-plus';
import Music from 'lucide-svelte/icons/music';
import PanelLeft from 'lucide-svelte/icons/panel-left';
import PanelRight from 'lucide-svelte/icons/panel-right';
import Pause from 'lucide-svelte/icons/pause';
import Play from 'lucide-svelte/icons/play';
import Plus from 'lucide-svelte/icons/plus';
import Radio from 'lucide-svelte/icons/radio';
import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
import Search from 'lucide-svelte/icons/search';
import SkipBack from 'lucide-svelte/icons/skip-back';
import SkipForward from 'lucide-svelte/icons/skip-forward';
import Sparkles from 'lucide-svelte/icons/sparkles';
import Trash2 from 'lucide-svelte/icons/trash-2';
import TriangleAlert from 'lucide-svelte/icons/triangle-alert';
import Volume2 from 'lucide-svelte/icons/volume-2';
import VolumeX from 'lucide-svelte/icons/volume-x';
import X from 'lucide-svelte/icons/x';
import Zap from 'lucide-svelte/icons/zap';

export const GLYPHS = {
	alert: TriangleAlert,
	bands: AudioLines,
	bolt: Zap,
	check: Check,
	chevronDown: ChevronDown,
	chevronLeft: ChevronLeft,
	chevronRight: ChevronRight,
	chevronUp: ChevronUp,
	link: Link,
	listMusic: ListMusic,
	music: Music,
	panelLeft: PanelLeft,
	panelRight: PanelRight,
	pause: Pause,
	play: Play,
	playNext: ListPlus,
	plus: Plus,
	radio: Radio,
	retry: RotateCcw,
	search: Search,
	skipBack: SkipBack,
	skipForward: SkipForward,
	sparkles: Sparkles,
	trash: Trash2,
	volume: Volume2,
	volumeOff: VolumeX,
	x: X
};

export type IconName = keyof typeof GLYPHS;
