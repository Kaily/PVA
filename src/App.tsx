import { useEffect } from 'react';
import { attachComputerKeyboard } from './input/ComputerKeyboard';
import { boot, unlockAudio } from './state/actions';
import { startBeatVisuals } from './ui/beat';
import { Instrument } from './ui/Instrument';
import { HelpOverlay } from './ui/overlays/HelpOverlay';

export function App() {
  useEffect(() => {
    void boot();
    startBeatVisuals();
    const detach = attachComputerKeyboard();

    // Browsers only start audio after a user gesture — take the first one, wherever it lands.
    const unlock = (): void => unlockAudio();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('touchend', unlock, true);
    return () => {
      detach();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('touchend', unlock, true);
    };
  }, []);

  return (
    <main className="stage">
      <h1 className="sr-only">PVA-61 Professional Arranger Keyboard</h1>
      <Instrument />
      <HelpOverlay />
    </main>
  );
}
