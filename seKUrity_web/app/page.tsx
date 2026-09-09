'use client';

import { useEffect } from 'react';

const studies = [
  {
    title: 'Computer Science',
    description:
      '보안을 시작하기 전에 필요한 각종 컴퓨터공학 지식을 습득합니다.',
  },
  {
    title: 'Web Hacking',
    description:
      '웹에서 발생하는 여러 취약점을 공부하고, 직접 활용하며 실습을 진행합니다.',
  },
  {
    title: 'PWN (System Hacking)',
    description:
      '프로그램의 동작 원리를 이해하고 시스템 취약점을 활용해 실습합니다.',
  },
  {
    title: 'Forensic',
    description:
      '디지털 증거 수집과 침해사고 분석에 필요한 지식과 주요 분석 도구를 익힙니다.',
  },
  {
    title: 'HTB',
    description:
      'HackTheBox 문제를 풀면서 펜테스팅과 레드티밍을 실습하고, 스터디원들과 Write-Up을 공유하며 새로운 것을 배워나갑니다.',
  },
];

const awards = [
  { year: '2021', title: '제3회 TS 보안 허점을 찾아라', result: '최우수상 · 우수상' },
  { year: '2022', title: '한국중부발전을 뚫어봐! 경진대회', result: '최우수상 · 장려상' },
  { year: '2022', title: '제2회 우리은행 금융보안원 모의해킹 대회', result: '대상' },
  { year: '2022', title: '제4회 TS 보안 허점을 찾아라', result: '우수상(일반부) · 우수상(학생부)' },
  { year: '2023', title: '제3회 우리은행 금융보안원 모의해킹 대회', result: '대상 · 최우수상 · 우수상' },
  { year: '2023', title: '제3회 우리콘', result: '우수상' },
  { year: '2024', title: 'KSC 학부생 / 주니어논문 경진대회', result: '학생부부문 장려상' },
  { year: '2024', title: '제4회 우리콘', result: '우수상' },
  { year: '2024', title: '금융보안아카데미 2024', result: '사이버위협 분석·대응분야 최우수상' },
  { year: '2024', title: 'fiesta', result: '장려상' },
  { year: '2024', title: '제5회 우리콘', result: '최우수상' },
  { year: '2024', title: '충청권 CTF', result: '장려상' },
  { year: '2025', title: 'Pwn2Own Automotive 2025', result: '글로벌 취약점 분석 대회 수상' },
  { year: '2026', title: 'DEF CON 34 CTF Finals', result: '7위 · 9위 · 12위' },
];

const activities = [
  { year: '2020', title: 'Best of the Best (BoB) 9기', detail: '보안컨설팅 3명 · 보안 제품 개발 1명' },
  { year: '2022', title: 'Best of the Best (BoB) 11기', detail: '취약점 분석 1명' },
  { year: '2023', title: 'SK 쉴더스 루키즈 14기', detail: '2명' },
  { year: '2023', title: 'WhiteHat School 1기', detail: '4명' },
  { year: '2023', title: 'Best of the Best (BoB) 12기', detail: '취약점 분석 2명 · 보안 컨설팅 3명' },
  { year: '2024', title: 'Best of the Best (BoB) 13기', detail: '취약점 분석 2명 · 디지털 포렌식 1명' },
  { year: '2026', title: 'WhiteHat School 4기', detail: '2명' },
];

function groupByYear<T extends { year: string }>(items: T[]) {
  return items.reduce<Array<{ year: string; items: T[] }>>((groups, item) => {
    const currentGroup = groups.at(-1);

    if (currentGroup?.year === item.year) {
      currentGroup.items.push(item);
    } else {
      groups.push({ year: item.year, items: [item] });
    }

    return groups;
  }, []);
}

const awardGroups = groupByYear(awards);
const activityGroups = groupByYear(activities);

export default function Home() {
  useEffect(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>('[data-reveal]'),
    );

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      elements.forEach((element) => element.classList.add('is-visible'));
      return;
    }

    document.documentElement.classList.add('motion-ready');

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -60px' },
    );

    elements.forEach((element) => observer.observe(element));

    return () => {
      observer.disconnect();
      document.documentElement.classList.remove('motion-ready');
    };
  }, []);

  const toggleTheme = () => {
    const currentTheme = document.documentElement.dataset.theme === 'dark'
      ? 'dark'
      : 'light';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    window.localStorage.setItem('sekurity-theme', nextTheme);
  };

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="seKUrity 홈">
          se<span>KU</span>rity
        </a>

        <nav className="main-nav" aria-label="주요 메뉴">
          <a href="#top">소개</a>
          <a href="#studies">스터디</a>
          <a href="#achievements">성과</a>
          <a href="#contact">연락처</a>
        </nav>

      </header>

      <button
        className="theme-toggle"
        type="button"
        onClick={toggleTheme}
        aria-label="화면 테마 전환"
        title="화면 테마 전환"
      >
        <span className="theme-icon-light" aria-hidden="true">☀</span>
        <span className="theme-icon-dark" aria-hidden="true">☾</span>
      </button>

      <main id="top">
        <section className="hero hero-simple">
          <div className="hero-copy">
            <p className="eyebrow"><span /> 건국대학교 글로컬캠퍼스 · 컴퓨터공학과</p>
            <h1 aria-label="seKUrity">
              se<span>KU</span>rity
            </h1>
            <div className="hero-intro">
              <p>
                seKUrity(세쿠리티)는 건국대학교 글로컬캠퍼스 컴퓨터공학과 소속
                <strong> 교내 유일 보안 소모임</strong>입니다.
              </p>
              <p>
                소모임에서 열심히 활동한 선배들은 안랩, 롯데정보통신, SK쉴더스 등에
                진출했습니다. 기초 지식이 부족하더라도 열정과 함께라면 보안과 관련된
                다양한 교내외 활동 경험을 쌓을 수 있습니다.
              </p>
            </div>

            <div className="hero-actions">
              <a className="primary-action" href="#studies">스터디 소개 <span aria-hidden="true">↓</span></a>
              <a className="text-action" href="#contact">연락처 <span aria-hidden="true">→</span></a>
            </div>
          </div>
        </section>

        <section className="studies-section section-pad" id="studies" aria-labelledby="studies-title">
          <div className="studies-intro" data-reveal>
            <h2 id="studies-title">스터디 목록</h2>
            <p>기초부터 실전까지, 다섯 가지 트랙을 중심으로 함께 공부합니다.</p>
          </div>
          <div className="study-grid">
            {studies.map((study) => (
              <article className="study-card" key={study.title} data-reveal>
                <h3>{study.title}</h3>
                <p>{study.description}</p>
                <span className="card-arrow" aria-hidden="true">↘</span>
              </article>
            ))}
          </div>
        </section>

        <section className="records-section section-pad" id="achievements" aria-labelledby="records-title">
          <div className="records-title-row" data-reveal>
            <h2 id="records-title">성과</h2>
            <p>연도별 수상 경력과 대외 활동 이력입니다.</p>
          </div>

          <div className="records-layout">
            <div className="record-column">
              <div className="record-column-title" data-reveal>
                <h3>수상 경력</h3>
              </div>
              <div className="year-groups">
                {awardGroups.map((group) => (
                  <section className="year-group" key={group.year} aria-labelledby={`award-${group.year}`} data-reveal>
                    <h4 className="year-label" id={`award-${group.year}`}>{group.year}</h4>
                    <div className="year-items">
                      {group.items.map((award) => (
                        <article className="record-item" key={award.title}>
                          <h5>{award.title}</h5>
                          <p>{award.result}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>

            <div className="record-column activity-column">
              <div className="record-column-title" data-reveal>
                <h3>대외 활동</h3>
              </div>
              <div className="year-groups">
                {activityGroups.map((group) => (
                  <section className="year-group" key={group.year} aria-labelledby={`activity-${group.year}`} data-reveal>
                    <h4 className="year-label" id={`activity-${group.year}`}>{group.year}</h4>
                    <div className="year-items">
                      {group.items.map((activity) => (
                        <article className="record-item" key={activity.title}>
                          <h5>{activity.title}</h5>
                          <p>{activity.detail}</p>
                        </article>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="contact-section" id="contact" aria-labelledby="contact-title">
          <div className="contact-lead" data-reveal>
            <h2 id="contact-title">연락처</h2>
            <p>소모임 문의는 아래 연락처를 이용해 주세요.</p>
          </div>
          <div className="contact-list">
            <article className="contact-card" data-reveal>
              <div className="contact-role"><strong>회장</strong></div>
              <a href="mailto:dleogus0910@kku.ac.kr">dleogus0910@kku.ac.kr <span>↗</span></a>
              <a href="tel:01063757718">010-6375-7718 <span>↗</span></a>
            </article>
            <article className="contact-card" data-reveal>
              <div className="contact-role"><strong>부회장</strong></div>
              <a href="mailto:junhyeok1021@hanmail.net">junhyeok1021@hanmail.net <span>↗</span></a>
              <a href="tel:01056752442">010-5675-2442 <span>↗</span></a>
            </article>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="wordmark" href="#top" aria-label="맨 위로 이동">se<span>KU</span>rity</a>
        <p>SEKURITY FOREVER</p>
      </footer>
    </div>
  );
}
