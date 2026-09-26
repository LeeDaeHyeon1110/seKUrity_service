'use client';

import { useState } from 'react';
import type { MemberProfile } from '@/lib/api';

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

export function MemberCard({ member }: { member: MemberProfile }) {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <article className="member-card">
      <div className="member-photo">
        {member.photoUrl && !imageFailed ? (
          // Protected same-origin images require the session cookie, so they bypass the image optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={member.photoUrl}
            alt={`${member.name}님의 소개 사진`}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span aria-hidden="true">{member.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="member-card-body">
        <h2>{member.name}</h2>
        <p className="member-introduction">
          {member.introduction || '아직 한 줄 소개를 작성하지 않았습니다.'}
        </p>
        {member.specialties.length > 0 && (
          <ul className="tag-list" aria-label={`${member.name}님의 주력 분야`}>
            {member.specialties.map((specialty) => <li key={specialty}>{specialty}</li>)}
          </ul>
        )}
        {member.links.length > 0 && (
          <div className="member-links">
            {member.links.map((link) => {
              const url = safeHttpUrl(link.url);
              if (!url) return null;
              return (
                <a key={link.url} href={url.href} target="_blank" rel="noreferrer">
                  {link.label?.trim() || url.hostname}
                  <span aria-hidden="true">↗</span>
                </a>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}
