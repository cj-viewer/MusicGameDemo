import type Phaser from 'phaser';
import type { ArtAssetSlot, MainScene } from '../scenes/MainScene';

interface AssetSlotConfig {
  id: ArtAssetSlot;
  label: string;
  hint: string;
}

const ASSET_SLOTS: AssetSlotConfig[] = [
  { id: 'background', label: '战斗背景', hint: '铺满 1280 × 720 场地' },
  { id: 'player', label: '玩家角色', hint: '静态覆盖序列帧，保持当前角色比例' },
  { id: 'guard', label: '保安敌人', hint: '当前与后续生成的保安' },
  { id: 'fan', label: '粉丝敌人', hint: '当前与后续生成的粉丝' }
];

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/** 网页内的临时美术替换面板：文件只在本地读取，刷新页面后恢复项目默认素材。 */
export class ArtAssetTool {
  private root: HTMLDivElement;
  private panel: HTMLDivElement;
  private toast: HTMLDivElement;
  private previewUrls = new Map<ArtAssetSlot, string>();
  private previewImages = new Map<ArtAssetSlot, HTMLImageElement>();
  private statusTexts = new Map<ArtAssetSlot, HTMLSpanElement>();

  constructor(private readonly game: Phaser.Game) {
    this.injectStyles();
    this.root = document.createElement('div');
    this.root.className = 'art-tool-root';
    this.panel = document.createElement('div');
    this.panel.className = 'art-tool-panel';
    this.toast = document.createElement('div');
    this.toast.className = 'art-tool-toast';
    this.buildUi();
    document.body.append(this.root, this.toast);
  }

  private buildUi(): void {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'art-tool-toggle';
    toggle.innerHTML = '<span aria-hidden="true">✦</span><span>美术替换</span>';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', () => {
      const open = this.panel.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(open));
    });

    const header = document.createElement('div');
    header.className = 'art-tool-header';
    header.innerHTML = '<div><strong>实时美术替换</strong><small>图片仅在本机预览，不会上传</small></div>';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'art-tool-close';
    close.setAttribute('aria-label', '关闭美术替换面板');
    close.textContent = '×';
    close.addEventListener('click', () => {
      this.panel.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
    header.append(close);
    this.panel.append(header);

    const list = document.createElement('div');
    list.className = 'art-tool-list';
    for (const config of ASSET_SLOTS) list.append(this.createAssetRow(config));
    this.panel.append(list);

    const footer = document.createElement('div');
    footer.className = 'art-tool-footer';
    const resetAll = document.createElement('button');
    resetAll.type = 'button';
    resetAll.className = 'art-tool-reset-all';
    resetAll.textContent = '全部恢复默认';
    resetAll.addEventListener('click', () => {
      const scene = this.scene();
      if (!scene) return this.showToast('游戏场景还未准备好', true);
      scene.resetAllArtAssets();
      for (const slot of ASSET_SLOTS) this.clearPreview(slot.id);
      this.showToast('已恢复全部默认素材');
    });
    const note = document.createElement('span');
    note.textContent = '支持 PNG / JPG / WebP / GIF，单张 ≤ 20 MB';
    footer.append(resetAll, note);
    this.panel.append(footer);

    this.root.append(toggle, this.panel);
    for (const eventName of ['pointerdown', 'pointerup', 'click', 'contextmenu', 'wheel']) {
      this.root.addEventListener(eventName, (event) => event.stopPropagation());
    }
  }

  private createAssetRow(config: AssetSlotConfig): HTMLDivElement {
    const row = document.createElement('div');
    row.className = 'art-tool-row';
    row.dataset.slot = config.id;

    const preview = document.createElement('div');
    preview.className = 'art-tool-preview';
    preview.dataset.empty = 'true';
    const image = document.createElement('img');
    image.alt = `${config.label}预览`;
    const placeholder = document.createElement('span');
    placeholder.textContent = config.id === 'background' ? '背景' : '角色';
    preview.append(image, placeholder);
    this.previewImages.set(config.id, image);

    const copy = document.createElement('div');
    copy.className = 'art-tool-copy';
    const title = document.createElement('strong');
    title.textContent = config.label;
    const hint = document.createElement('small');
    hint.textContent = config.hint;
    const status = document.createElement('span');
    status.className = 'art-tool-status';
    status.textContent = '使用项目默认';
    this.statusTexts.set(config.id, status);
    copy.append(title, hint, status);

    const actions = document.createElement('div');
    actions.className = 'art-tool-actions';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void this.loadAsset(config, file);
      input.value = '';
    });
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.className = 'art-tool-choose';
    choose.textContent = '选择图片';
    choose.addEventListener('click', () => input.click());
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'art-tool-reset';
    reset.textContent = '恢复';
    reset.addEventListener('click', () => {
      const scene = this.scene();
      if (!scene) return this.showToast('游戏场景还未准备好', true);
      scene.resetArtAsset(config.id);
      this.clearPreview(config.id);
      this.showToast(`${config.label}已恢复默认`);
    });
    actions.append(input, choose, reset);

    for (const eventName of ['dragenter', 'dragover']) {
      row.addEventListener(eventName, (event) => {
        event.preventDefault();
        row.classList.add('is-dragging');
      });
    }
    row.addEventListener('dragleave', () => row.classList.remove('is-dragging'));
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      row.classList.remove('is-dragging');
      const file = event.dataTransfer?.files[0];
      if (file) void this.loadAsset(config, file);
    });

    row.append(preview, copy, actions);
    return row;
  }

  private async loadAsset(config: AssetSlotConfig, file: File): Promise<void> {
    if (!ACCEPTED_TYPES.has(file.type)) {
      this.showToast('请选择 PNG、JPG、WebP 或 GIF 图片', true);
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      this.showToast('图片超过 20 MB，请压缩后重试', true);
      return;
    }

    const scene = this.scene();
    if (!scene) {
      this.showToast('游戏场景还未准备好', true);
      return;
    }

    const url = URL.createObjectURL(file);
    try {
      const image = await this.decodeImage(url);
      scene.applyArtAsset(config.id, image);
      const previous = this.previewUrls.get(config.id);
      if (previous) URL.revokeObjectURL(previous);
      this.previewUrls.set(config.id, url);
      const preview = this.previewImages.get(config.id)!;
      preview.src = url;
      preview.parentElement!.dataset.empty = 'false';
      this.statusTexts.get(config.id)!.textContent = `${file.name} · ${image.naturalWidth}×${image.naturalHeight}`;
      this.showToast(`${config.label}已实时替换`);
    } catch {
      URL.revokeObjectURL(url);
      this.showToast('图片读取失败，请换一张图片重试', true);
    }
  }

  private decodeImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Image decode failed'));
      image.src = url;
    });
  }

  private clearPreview(slot: ArtAssetSlot): void {
    const url = this.previewUrls.get(slot);
    if (url) URL.revokeObjectURL(url);
    this.previewUrls.delete(slot);
    const preview = this.previewImages.get(slot)!;
    preview.removeAttribute('src');
    preview.parentElement!.dataset.empty = 'true';
    this.statusTexts.get(slot)!.textContent = '使用项目默认';
  }

  private scene(): MainScene | undefined {
    const scene = this.game.scene.getScene('MainScene') as MainScene | undefined;
    return scene?.sys?.isActive() ? scene : undefined;
  }

  private showToast(message: string, error = false): void {
    this.toast.textContent = message;
    this.toast.classList.toggle('is-error', error);
    this.toast.classList.add('is-visible');
    window.setTimeout(() => this.toast.classList.remove('is-visible'), 1800);
  }

  private injectStyles(): void {
    const style = document.createElement('style');
    style.textContent = `
      .art-tool-root { position: fixed; top: 16px; right: 16px; z-index: 1000; font-family: Inter, "Microsoft YaHei", sans-serif; color: #eef2ff; }
      .art-tool-toggle { display: flex; align-items: center; gap: 8px; margin-left: auto; border: 1px solid rgba(196,181,253,.55); border-radius: 999px; padding: 9px 14px; color: #fff; background: rgba(20,16,42,.86); box-shadow: 0 8px 28px rgba(0,0,0,.35), inset 0 0 18px rgba(168,85,247,.12); backdrop-filter: blur(12px); cursor: pointer; font-size: 13px; font-weight: 700; }
      .art-tool-toggle:hover { border-color: #d8b4fe; background: rgba(35,25,67,.94); }
      .art-tool-toggle > span:first-child { color: #d8b4fe; font-size: 17px; }
      .art-tool-panel { display: none; width: min(430px, calc(100vw - 32px)); max-height: calc(100vh - 76px); margin-top: 10px; overflow: auto; border: 1px solid rgba(148,163,184,.3); border-radius: 16px; background: rgba(10,13,28,.96); box-shadow: 0 20px 60px rgba(0,0,0,.55); backdrop-filter: blur(18px); }
      .art-tool-panel.is-open { display: block; animation: art-tool-in .14s ease-out; }
      @keyframes art-tool-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }
      .art-tool-header { display: flex; align-items: flex-start; justify-content: space-between; padding: 16px 16px 12px; border-bottom: 1px solid rgba(148,163,184,.16); }
      .art-tool-header strong { display: block; font-size: 16px; }
      .art-tool-header small { display: block; margin-top: 4px; color: #94a3b8; font-size: 11px; }
      .art-tool-close { width: 28px; height: 28px; border: 0; border-radius: 8px; color: #cbd5e1; background: rgba(148,163,184,.1); cursor: pointer; font-size: 20px; line-height: 1; }
      .art-tool-list { padding: 8px; }
      .art-tool-row { display: grid; grid-template-columns: 58px 1fr auto; gap: 11px; align-items: center; min-height: 68px; padding: 9px; border: 1px solid transparent; border-radius: 12px; transition: .15s ease; }
      .art-tool-row + .art-tool-row { margin-top: 3px; }
      .art-tool-row:hover { background: rgba(148,163,184,.06); }
      .art-tool-row.is-dragging { border-color: #a78bfa; background: rgba(139,92,246,.14); }
      .art-tool-preview { position: relative; width: 58px; height: 50px; overflow: hidden; border: 1px dashed rgba(148,163,184,.35); border-radius: 9px; background: rgba(15,23,42,.75); }
      .art-tool-preview img { width: 100%; height: 100%; object-fit: contain; }
      .art-tool-preview span { position: absolute; inset: 0; display: none; place-items: center; color: #64748b; font-size: 11px; }
      .art-tool-preview[data-empty="true"] span { display: grid; }
      .art-tool-copy { min-width: 0; }
      .art-tool-copy strong, .art-tool-copy small, .art-tool-status { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .art-tool-copy strong { font-size: 13px; }
      .art-tool-copy small { margin-top: 3px; color: #94a3b8; font-size: 10px; }
      .art-tool-status { margin-top: 4px; color: #c4b5fd; font-size: 10px; }
      .art-tool-actions { display: flex; flex-direction: column; gap: 5px; }
      .art-tool-actions button, .art-tool-reset-all { border: 1px solid rgba(148,163,184,.25); border-radius: 7px; padding: 5px 9px; cursor: pointer; font: inherit; font-size: 10px; }
      .art-tool-choose { color: #fff; background: rgba(124,58,237,.55); }
      .art-tool-choose:hover { background: rgba(139,92,246,.8); }
      .art-tool-reset { color: #cbd5e1; background: rgba(30,41,59,.7); }
      .art-tool-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 14px 14px; border-top: 1px solid rgba(148,163,184,.16); }
      .art-tool-footer span { max-width: 210px; color: #64748b; font-size: 9px; text-align: right; }
      .art-tool-reset-all { color: #fecaca; background: rgba(127,29,29,.22); }
      .art-tool-toast { position: fixed; left: 50%; bottom: 28px; z-index: 1100; transform: translate(-50%, 12px); opacity: 0; pointer-events: none; border: 1px solid rgba(134,239,172,.3); border-radius: 999px; padding: 9px 16px; color: #dcfce7; background: rgba(6,78,59,.92); box-shadow: 0 10px 30px rgba(0,0,0,.4); font: 12px Inter, "Microsoft YaHei", sans-serif; transition: .18s ease; }
      .art-tool-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
      .art-tool-toast.is-error { border-color: rgba(252,165,165,.35); color: #fee2e2; background: rgba(127,29,29,.94); }
      @media (max-width: 560px) { .art-tool-root { top: 8px; right: 8px; } .art-tool-panel { max-height: calc(100vh - 62px); } .art-tool-row { grid-template-columns: 50px 1fr; } .art-tool-actions { grid-column: 1 / -1; flex-direction: row; justify-content: flex-end; } .art-tool-preview { width: 50px; height: 44px; } }
    `;
    document.head.append(style);
  }
}
