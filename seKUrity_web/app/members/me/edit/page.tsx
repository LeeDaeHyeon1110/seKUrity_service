'use client';

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AccessGate, LoadingPanel, PageHeading, StatusPanel } from '@/components/page-ui';
import {
  ApiError,
  apiPaths,
  apiRequest,
  getErrorMessage,
  type MemberLink,
  type MemberProfile,
} from '@/lib/api';

const MAX_INTRODUCTION = 100;
const MAX_SPECIALTIES = 5;
const MAX_LINKS = 5;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const emptyProfile: MemberProfile = {
  userId: '',
  name: '',
  introduction: '',
  specialties: [],
  links: [],
  photoUrl: null,
};

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function EditMemberProfilePage() {
  return (
    <main className="app-main">
      <AccessGate activeMember>
        <ProfileEditor />
      </AccessGate>
    </main>
  );
}

function ProfileEditor() {
  const [profile, setProfile] = useState<MemberProfile>(emptyProfile);
  const [tagInput, setTagInput] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfile(await apiRequest<MemberProfile>(apiPaths.profile));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        setProfile(emptyProfile);
      } else {
        setError(getErrorMessage(cause));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => void loadProfile());
  }, [loadProfile]);

  const photoPreview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo]);

  useEffect(() => {
    if (photoPreview) return () => URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const addSpecialty = () => {
    const value = tagInput.trim();
    if (!value || profile.specialties.includes(value) || profile.specialties.length >= MAX_SPECIALTIES) return;
    setProfile((current) => ({ ...current, specialties: [...current.specialties, value] }));
    setTagInput('');
  };

  const handleTagKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addSpecialty();
    }
  };

  const addLink = () => {
    if (profile.links.length >= MAX_LINKS) return;
    setProfile((current) => ({ ...current, links: [...current.links, { label: '', url: '' }] }));
  };

  const updateLink = (index: number, field: keyof MemberLink, value: string) => {
    setProfile((current) => ({
      ...current,
      links: current.links.map((link, linkIndex) =>
        linkIndex === index ? { ...link, [field]: value } : link,
      ),
    }));
  };

  const selectPhoto = (file?: File) => {
    setError(null);
    if (!file) {
      setPhoto(null);
      return;
    }
    if (!ACCEPTED_PHOTO_TYPES.has(file.type)) {
      setError('사진은 JPEG, PNG 또는 WebP 형식만 업로드할 수 있습니다.');
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
      setError('사진 파일은 5MB 이하여야 합니다.');
      return;
    }
    setPhoto(file);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (profile.introduction.length > MAX_INTRODUCTION) {
      setError('한 줄 소개는 100자 이하여야 합니다.');
      return;
    }
    if (profile.links.some((link) => !isHttpUrl(link.url.trim()))) {
      setError('모든 링크는 http:// 또는 https://로 시작하는 올바른 주소여야 합니다.');
      return;
    }

    setSaving(true);
    try {
      const saved = await apiRequest<MemberProfile>(apiPaths.profile, {
        method: 'PUT',
        body: {
          introduction: profile.introduction.trim(),
          specialties: profile.specialties,
          links: profile.links.map((link) => ({
            label: link.label?.trim() || undefined,
            url: link.url.trim(),
          })),
        },
      });

      let photoUrl = saved.photoUrl;
      if (photo) {
        const body = new FormData();
        body.append('photo', photo);
        const uploaded = await apiRequest<{ photoUrl: string }>(apiPaths.profilePhoto, {
          method: 'POST',
          body,
        });
        photoUrl = uploaded.photoUrl;
      }

      setProfile({ ...saved, photoUrl });
      setPhoto(null);
      setSuccess('소개 카드가 저장되었습니다.');
    } catch (cause) {
      setError(getErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeading
        className="member-page-heading"
        title="소개 카드 수정"
        description="활동 부원에게만 공개되는 프로필입니다. 필요한 정보만 공유해 주세요."
        actions={<a className="outline-button" href="/members">목록으로 돌아가기</a>}
      />

      {loading ? (
        <LoadingPanel label="소개 카드를 불러오는 중입니다." />
      ) : error && profile === emptyProfile ? (
        <StatusPanel
          title="소개 카드를 불러오지 못했습니다"
          message={error}
          tone="danger"
          action={<button className="outline-button" type="button" onClick={() => void loadProfile()}>다시 시도</button>}
        />
      ) : (
        <form className="profile-form" onSubmit={(event) => void handleSubmit(event)}>
          <section className="form-panel photo-panel" aria-labelledby="photo-title">
            <div className="form-section-heading">
              <h2 id="photo-title">소개 사진</h2>
              <p>JPEG, PNG, WebP · 최대 5MB</p>
            </div>
            <div className="photo-editor">
              <div className="photo-preview">
                {photoPreview || profile.photoUrl ? (
                  // The preview is either a local blob URL or a protected same-origin resource.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photoPreview ?? profile.photoUrl ?? ''} alt="소개 사진 미리보기" />
                ) : (
                  <span>사진 없음</span>
                )}
              </div>
              <label className="outline-button file-button">
                사진 선택
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => selectPhoto(event.target.files?.[0])}
                />
              </label>
              {photo && <span className="selected-file">{photo.name}</span>}
            </div>
          </section>

          <section className="form-panel" aria-labelledby="intro-title">
            <div className="form-section-heading">
              <h2 id="intro-title">한 줄 소개</h2>
              <p>어떤 사람인지 간단히 알려주세요.</p>
            </div>
            <label className="field-block">
              <span className="field-label">한 줄 소개</span>
              <textarea
                value={profile.introduction}
                maxLength={MAX_INTRODUCTION}
                rows={3}
                placeholder="예: 웹 보안과 취약점 분석을 공부하고 있습니다."
                onChange={(event) => setProfile((current) => ({ ...current, introduction: event.target.value }))}
              />
              <span className="field-help">{profile.introduction.length} / {MAX_INTRODUCTION}자</span>
            </label>
          </section>

          <section className="form-panel" aria-labelledby="specialty-title">
            <div className="form-section-heading">
              <h2 id="specialty-title">주력 분야</h2>
              <p>최대 5개까지 자유롭게 입력할 수 있습니다.</p>
            </div>
            <div className="field-block">
              <label className="field-label" htmlFor="specialty-input">분야 추가</label>
              <div className="inline-field">
                <input
                  id="specialty-input"
                  value={tagInput}
                  maxLength={30}
                  placeholder="예: Web Hacking"
                  disabled={profile.specialties.length >= MAX_SPECIALTIES}
                  onChange={(event) => setTagInput(event.target.value)}
                  onKeyDown={handleTagKeyDown}
                />
                <button className="outline-button" type="button" disabled={!tagInput.trim() || profile.specialties.length >= MAX_SPECIALTIES} onClick={addSpecialty}>추가</button>
              </div>
              {profile.specialties.length > 0 && (
                <ul className="editable-tags" aria-label="입력한 주력 분야">
                  {profile.specialties.map((specialty) => (
                    <li key={specialty}>
                      {specialty}
                      <button
                        type="button"
                        aria-label={`${specialty} 삭제`}
                        onClick={() => setProfile((current) => ({
                          ...current,
                          specialties: current.specialties.filter((item) => item !== specialty),
                        }))}
                      >×</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section className="form-panel" aria-labelledby="links-title">
            <div className="form-section-heading">
              <h2 id="links-title">포트폴리오 및 블로그</h2>
              <p>http 또는 https 주소를 최대 5개까지 등록할 수 있습니다.</p>
            </div>
            <div className="link-fields">
              {profile.links.map((link, index) => (
                <div className="link-field-row" key={index}>
                  <label>
                    <span className="field-label">표시 이름</span>
                    <input
                      value={link.label ?? ''}
                      maxLength={40}
                      placeholder="예: 개인 블로그"
                      onChange={(event) => updateLink(index, 'label', event.target.value)}
                    />
                  </label>
                  <label>
                    <span className="field-label">주소</span>
                    <input
                      type="url"
                      required
                      value={link.url}
                      placeholder="https://example.com"
                      onChange={(event) => updateLink(index, 'url', event.target.value)}
                    />
                  </label>
                  <button
                    className="icon-button danger-button"
                    type="button"
                    aria-label={`${index + 1}번째 링크 삭제`}
                    onClick={() => setProfile((current) => ({
                      ...current,
                      links: current.links.filter((_, linkIndex) => linkIndex !== index),
                    }))}
                  >×</button>
                </div>
              ))}
              {profile.links.length < MAX_LINKS && (
                <button className="outline-button add-row-button" type="button" onClick={addLink}>링크 추가</button>
              )}
            </div>
          </section>

          {error && <div className="form-message error-message" role="alert">{error}</div>}
          {success && <div className="form-message success-message" role="status">{success}</div>}

          <div className="sticky-form-actions">
            <a className="outline-button" href="/members">취소</a>
            <button className="primary-button" type="submit" disabled={saving}>
              {saving ? '저장 중…' : '소개 카드 저장'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
