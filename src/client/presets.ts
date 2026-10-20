export const presets: Readonly<Record<string, { label: string; background: string }>> = {
  aurora: {
    label: '极光',
    background:
      'radial-gradient(ellipse at 15% 25%, #47c9a3 0%, transparent 55%), ' +
      'radial-gradient(ellipse at 85% 10%, #8094ed 0%, transparent 60%), ' +
      'linear-gradient(140deg, #153c58, #214f61 50%, #ba9bd3)',
  },
  ocean: {
    label: '深海',
    background:
      'radial-gradient(ellipse at 80% 0%, #78d9e7, transparent 65%), ' +
      'linear-gradient(155deg, #3686a7, #193c69 50%, #0c1636)',
  },
  sunset: {
    label: '落日',
    background:
      'radial-gradient(ellipse at 70% 20%, #ffdeb4, transparent 50%), ' +
      'linear-gradient(150deg, #d6a2af, #b77897 45%, #536a92)',
  },
  night: {
    label: '夜航',
    background:
      'radial-gradient(ellipse at 80% 20%, #6267b0, transparent 50%), ' +
      'linear-gradient(140deg, #102333, #273b52 50%, #221f3b)',
  },
};
