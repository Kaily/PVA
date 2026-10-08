import { services } from '../services';
import { Wheel } from './controls/Wheel';
import { useApp } from './hooks';
import { Keybed } from './keyboard/Keybed';
import { SplitMarker } from './keyboard/SplitMarker';
import { ControlColumn, DisplaySection, MasterSection, PerformSection, ToneSection } from './panel/Sections';

/** The whole instrument: control panel on top, wheels and keybed below. */
export function Instrument() {
  const power = useApp((s) => s.power);
  const bendRange = useApp((s) => s.bendRange);

  const { controller } = services();

  return (
    <div className={`chassis${power ? '' : ' chassis--off'}`}>
      <div className="chassis__top">
        <div className="speaker speaker--left">
          <div className="brand">
            <span className="brand__mark">
              PVA<b>61</b>
            </span>
            <span className="brand__line">Professional Arranger</span>
          </div>
          <div className="speaker__grille" aria-hidden="true" />
        </div>

        <div className="panel">
          <MasterSection />
          <ToneSection />
          <DisplaySection />
          <PerformSection />
          <ControlColumn />
        </div>

        <div className="speaker speaker--right">
          <div className="brand brand--right">
            <span className="brand__line">61 keys</span>
            <span className="brand__line brand__line--dim">64-voice polyphony</span>
          </div>
          <div className="speaker__grille" aria-hidden="true" />
        </div>
      </div>

      <div className="chassis__felt" aria-hidden="true" />

      <div className="chassis__bottom">
        <div className="cheek cheek--left">
          <div className="wheels">
            <Wheel
              label="Pitch bend"
              mode="spring"
              onChange={(v) => controller.setBend(v)}
              follow={(apply) => controller.events.on('bend', apply)}
            />
            <Wheel
              label="Modulation"
              mode="free"
              onChange={(v) => controller.setModulation(v)}
              follow={(apply) => controller.events.on('modulation', apply)}
            />
          </div>
          <span className="cheek__note">Bend ±{bendRange}</span>
        </div>
        <div className="keyzone">
          <Keybed />
          <SplitMarker />
        </div>
        <div className="cheek cheek--right" aria-hidden="true" />
      </div>

      <div className="chassis__lip" aria-hidden="true" />
    </div>
  );
}
