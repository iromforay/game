import { useEffect, useState } from 'react';
import { KIRBY_GRADES, KIRBY_CHARACTERS, KIRBY_WEAPONS } from './kirbyGuideData';
import './KirbyGuide.css';

interface KirbyGuideProps {
  onBack: () => void;
}

const SCROLL_TOP_THRESHOLD = 400;

export function KirbyGuide({ onBack }: KirbyGuideProps) {
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > SCROLL_TOP_THRESHOLD);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: 'smooth' });

  return (
    <div className="kirby-guide">
      <header className="kirby-guide-header">
        <button type="button" className="kirby-guide-back" onClick={onBack}>
          ← 허브로
        </button>
        <h1>🎀 커비 훔치기 — 도감</h1>
        <p>Steal a Kirby · 캐릭터 · 등급 · 무기 안내</p>
        <nav>
          <a href="#kirby-characters">캐릭터</a>
          <a href="#kirby-grades">등급 안내</a>
          <a href="#kirby-weapons">무기</a>
        </nav>
      </header>

      <section id="kirby-grades">
        <h2>등급 안내</h2>
        <p className="kirby-guide-desc">
          레드카펫에 등장하는 커비는 총 6단계 등급으로 나뉩니다. 등급이 높을수록 등장 확률은 낮지만, 초당 수익과
          판매가가 높고 훔치기 난이도도 올라갑니다.
          <br />※ 아래 가격/수익 수치는 밸런싱 이전 임시값입니다.
        </p>
        <table className="kirby-grade-table">
          <thead>
            <tr>
              <th>등급</th>
              <th>등장 확률(가중치)</th>
              <th>구매가</th>
              <th>초당 수익</th>
              <th>판매가</th>
              <th>훔치기 난이도</th>
            </tr>
          </thead>
          <tbody>
            {KIRBY_GRADES.map((g) => (
              <tr key={g.id}>
                <td>
                  <span className="kirby-grade-chip" style={{ background: g.color }}>
                    {g.name}
                  </span>
                </td>
                <td>{g.weightLabel}</td>
                <td>{g.buyPrice.toLocaleString()}</td>
                <td>{g.incomePerTick.toLocaleString()}</td>
                <td>{g.sellPrice.toLocaleString()}</td>
                <td>{g.difficulty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section id="kirby-characters">
        <h2>캐릭터 소개</h2>
        <p className="kirby-guide-desc">
          별의 커비 시리즈의 카피 능력 캐릭터·프렌즈·보스가 그대로 등장합니다. 같은 등급 안에서는 등장 확률(가중치)이
          동일합니다.
        </p>
        {KIRBY_GRADES.map((g) => {
          const members = KIRBY_CHARACTERS.filter((c) => c.gradeId === g.id);
          return (
            <div className="kirby-grade-group" key={g.id}>
              <div className="kirby-grade-group-title">
                <span className="kirby-grade-bar" style={{ background: g.color }} />
                <h3>{g.name}</h3>
                <span>{members.length}종</span>
              </div>
              <div className="kirby-char-grid">
                {members.map((c) => (
                  <div className="kirby-char-card" key={c.code}>
                    <img src={c.image} alt={c.name} loading="lazy" />
                    <div className="kirby-char-name">{c.name}</div>
                    <span className="kirby-char-grade-tag" style={{ background: g.color }}>
                      {g.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </section>

      <section id="kirby-weapons">
        <h2>무기 소개</h2>
        <p className="kirby-guide-desc">
          기지 주인은 무기로 침입자를 직접 타격해 붙잡을 수 있습니다. 상위 무기일수록 필요 명중 횟수가 줄어듭니다.
          1차 출시는 <b>방망이</b>만 사용 가능하며, 철퇴/총은 추후 오픈 예정입니다.
        </p>
        <div className="kirby-weapon-grid">
          {KIRBY_WEAPONS.map((w) => (
            <div className={`kirby-weapon-card${w.status === 'locked' ? ' locked' : ''}`} key={w.name}>
              <span className={`kirby-weapon-status ${w.status}`}>{w.status === 'open' ? '오픈' : '미오픈'}</span>
              <img src={w.image} alt={w.name} loading="lazy" />
              <h3>{w.name}</h3>
              <div className="kirby-weapon-type">{w.type}</div>
              <ul className="kirby-weapon-stats">
                {w.stats.map(([k, v]) => (
                  <li key={k}>
                    <span>{k}</span>
                    <b>{v}</b>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="kirby-guide-footer">내부 개발용 도감 페이지 · Steal a Kirby</footer>

      {showScrollTop && (
        <button type="button" className="kirby-guide-scroll-top" onClick={scrollToTop} aria-label="맨 위로">
          ↑
        </button>
      )}
    </div>
  );
}
