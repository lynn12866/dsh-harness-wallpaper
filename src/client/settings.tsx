import * as React from 'react';
import {
  Button,
  IconChevronDownOutlineRegular,
  IconPaperclipOutlineRegular,
  IconPauseOutlineRegular,
  IconPlayOutlineRegular,
  IconTrashOutlineRegular,
  Input,
  Menu,
  Modal,
  SegmentedControl,
  Switch,
  Tag,
  fileSizeText,
} from '@deepseek-ai/dsh-client-ui-primitives';
import type { NumericSetting } from '../shared/types.ts';
import type { WallpaperController } from './controller.ts';
import { presets } from './presets.ts';

interface SliderSettingProps {
  name: NumericSetting;
  label: string;
  value: number;
  maximum: number;
  hint: string;
  disabled: boolean;
  controller: WallpaperController;
}

function SliderSetting(props: SliderSettingProps): React.ReactElement {
  const id = `dsh-harness-wallpaper-${props.name}-range`;
  const messageId = `${id}-message`;

  return (
    <div className="dsh-harness-wallpaper-setting">
      <div className="dsh-harness-wallpaper-setting-heading">
        <label className="dsh-harness-wallpaper-setting-label" htmlFor={id}>
          {props.label}
        </label>
        <output className="dsh-harness-wallpaper-setting-value" htmlFor={id}>
          {props.value}
        </output>
      </div>
      <Input
        id={id}
        className="dsh-harness-wallpaper-setting-slider"
        type="range"
        aria-label={`${props.label}滑块`}
        aria-describedby={messageId}
        min={0}
        max={props.maximum}
        step={1}
        value={props.value}
        style={
          {
            '--dsh-harness-wallpaper-slider-progress': `${(props.value / props.maximum) * 100}%`,
          } as React.CSSProperties
        }
        disabled={props.disabled}
        onChange={(event) => {
          props.controller.update({ [props.name]: Number(event.currentTarget.value) });
        }}
      />
      <p id={messageId} className="dsh-harness-wallpaper-setting-hint">
        {props.hint}
      </p>
    </div>
  );
}

/** Harness range inputs provide compact wallpaper adjustment. */
export function WallpaperSettings({
  controller,
}: {
  controller: WallpaperController;
}): React.ReactElement {
  const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  const config = state.config;
  const disabled = !state.ready || state.busy;
  const current = state.assets.find((asset) => asset.id === config?.selected);
  const currentLabel = (config && presets[config.selected]?.label) ?? current?.name ?? '选择壁纸';

  return (
    <div
      className="dsh-harness-wallpaper-settings"
      aria-label="动态壁纸"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void controller.upload(event.dataTransfer.files[0]);
      }}
    >
      <div className="dsh-harness-wallpaper-settings-row">
        <span>启用壁纸</span>
        <Switch
          label="启用壁纸"
          checked={config?.enabled ?? false}
          disabled={disabled}
          onChange={(enabled) => controller.update({ enabled })}
        />
      </div>

      <div className="dsh-harness-wallpaper-settings-actions" role="status" aria-live="polite">
        <Tag tone="neutral">{state.status}</Tag>
        {state.error && controller.hasUnsavedChanges() && (
          <Button size="sm" variant="outline" onClick={() => void controller.retrySave()}>
            重试保存
          </Button>
        )}
        {state.error && !state.ready && (
          <Button size="sm" variant="outline" onClick={() => void controller.reload()}>
            重新载入
          </Button>
        )}
      </div>

      {config && (
        <>
          <div className="dsh-harness-wallpaper-settings-row">
            <span>当前壁纸</span>
            <Menu
              open={menuOpen}
              portal
              autoFocus
              compact
              selectedId={config.selected}
              items={[
                ...Object.entries(presets).map(([id, preset]) => ({ id, label: preset.label })),
                ...state.assets.map((asset) => ({ id: asset.id, label: asset.name })),
              ]}
              onSelect={(selected) => {
                setMenuOpen(false);
                controller.update({ selected, enabled: true });
              }}
              onClose={() => setMenuOpen(false)}
              anchor={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  aria-label="选择壁纸"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(!menuOpen)}
                >
                  {currentLabel}
                  <IconChevronDownOutlineRegular size={14} />
                </Button>
              }
            />
          </div>

          <div className="dsh-harness-wallpaper-settings-actions">
            <Button
              size="sm"
              variant="outline"
              icon={<IconPaperclipOutlineRegular size={14} />}
              disabled={disabled}
              onClick={() => input.current?.click()}
            >
              上传图片、动图或视频
            </Button>
            <input
              ref={input}
              type="file"
              hidden
              aria-label="选择壁纸文件"
              accept=".png,.jpg,.jpeg,.gif,.webp,.avif,.mp4,.webm,.m4v,.mov"
              disabled={disabled}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                void controller.upload(file);
              }}
            />
            {state.uploading && (
              <Button size="sm" variant="outline" onClick={() => controller.cancelUpload()}>
                取消上传
              </Button>
            )}
          </div>

          <p className="dsh-harness-wallpaper-settings-help">
            可拖放文件到此页。支持图片、GIF、MP4 / WebM；单文件 ≤100 MiB。
          </p>

          {state.assets.length > 0 && (
            <div className="dsh-harness-wallpaper-settings-list" aria-label="我的壁纸">
              {state.assets.map((asset) => (
                <div key={asset.id} className="dsh-harness-wallpaper-settings-row">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={disabled}
                    aria-label={`应用 ${asset.name}`}
                    aria-pressed={config.selected === asset.id}
                    onClick={() => controller.update({ selected: asset.id, enabled: true })}
                  >
                    <span className="dsh-harness-wallpaper-settings-filename">{asset.name}</span>
                  </Button>
                  <div className="dsh-harness-wallpaper-settings-actions">
                    <Tag tone="quiet">{fileSizeText(asset.bytes)}</Tag>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={`删除 ${asset.name}`}
                      icon={<IconTrashOutlineRegular size={14} />}
                      onClick={() => setDeleting(asset.id)}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="dsh-harness-wallpaper-settings-fields">
            <SliderSetting
              name="opacity"
              label="壁纸不透明度（%）"
              value={config.opacity}
              maximum={100}
              hint="越高，壁纸色彩越明显。"
              disabled={disabled}
              controller={controller}
            />
            <SliderSetting
              name="transparency"
              label="界面透明度（%）"
              value={config.transparency}
              maximum={100}
              hint="调整侧栏、输入框与消息背景；弹窗及控件保持原生外观。"
              disabled={disabled}
              controller={controller}
            />
            <SliderSetting
              name="dim"
              label="阅读遮罩（%）"
              value={config.dim}
              maximum={100}
              hint="随浅色／深色主题切换，越高越利于阅读。"
              disabled={disabled}
              controller={controller}
            />
            <SliderSetting
              name="blur"
              label="背景模糊（px）"
              value={config.blur}
              maximum={30}
              hint="柔化背景，范围 0–30 px。"
              disabled={disabled}
              controller={controller}
            />
          </div>

          <div className="dsh-harness-wallpaper-settings-row">
            <span>填充方式</span>
            <SegmentedControl
              id="dsh-harness-wallpaper-fit"
              label="填充方式"
              value={config.fit}
              disabled={disabled}
              options={[
                { value: 'cover', label: '铺满' },
                { value: 'contain', label: '完整显示' },
              ]}
              onChange={(fit) => {
                if (fit === 'cover' || fit === 'contain') {
                  controller.update({ fit });
                }
              }}
            />
          </div>

          <div className="dsh-harness-wallpaper-settings-actions">
            {current?.kind === 'video' && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                icon={
                  config.playing ? (
                    <IconPauseOutlineRegular size={14} />
                  ) : (
                    <IconPlayOutlineRegular size={14} />
                  )
                }
                onClick={() => controller.update({ playing: !config.playing })}
              >
                {config.playing ? '暂停视频' : '播放视频'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => controller.update({ enabled: false })}
            >
              恢复默认界面
            </Button>
          </div>

          <p className="dsh-harness-wallpaper-settings-help">
            文件保存在本机。视频静音循环，页面隐藏或系统减少动态效果时暂停；GIF 持续播放。
          </p>
        </>
      )}

      <Modal
        open={deleting !== null}
        title="删除壁纸"
        closeLabel="关闭"
        description="删除本机媒体库中的此文件？删除当前壁纸后会恢复默认界面。"
        onClose={() => setDeleting(null)}
        footer={
          <>
            <Button size="sm" variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                if (deleting) {
                  void controller.remove(deleting);
                }
                setDeleting(null);
              }}
            >
              确认删除
            </Button>
          </>
        }
      />
    </div>
  );
}
