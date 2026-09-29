import { useEffect, useState } from 'react';
import { cloudClient, cloudErrorMessage } from '../services/api/cloudClient';
import type { CloudSharedProject } from '../domain/cloud';
import { MarkdownPreview } from './MarkdownPreview';

export function SharedProjectPage({ token }: { token: string }) {
  const [data, setData] = useState<CloudSharedProject | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void cloudClient
      .sharedProject(token)
      .then((value) => {
        if (active) setData(value);
      })
      .catch((failure) => {
        if (active) setError(cloudErrorMessage(failure));
      });
    return () => {
      active = false;
    };
  }, [token]);
  if (error)
    return (
      <main className="cloud-loading" role="alert">
        <p>{error}</p>
        <a href={`${import.meta.env.BASE_URL}#/`}>返回 PromptDesk</a>
      </main>
    );
  if (!data)
    return (
      <main className="cloud-loading" role="status">
        正在打开分享…
      </main>
    );
  return (
    <div className="cloud-shared">
      <header className="cloud-shared-topbar">
        <span className="cloud-brand">PromptDesk</span>
        <span className="cloud-shared-badge">只读分享</span>
      </header>
      <main className="cloud-shared-body">
        <h1>{data.project.name}</h1>
        {data.project.description && (
          <p className="cloud-shared-description">{data.project.description}</p>
        )}
        {data.prompts.length ? (
          data.prompts.map((prompt, index) => (
            <article key={index} className="cloud-shared-prompt">
              <h2>{prompt.title}</h2>
              <MarkdownPreview body={prompt.body} />
            </article>
          ))
        ) : (
          <p className="cloud-empty">这个项目还没有可分享的提示词。</p>
        )}
        <p className="cloud-storage-note">
          这是只读分享页，内容由项目所有者公开，可随时撤销。历史版本不在此展示。
        </p>
      </main>
    </div>
  );
}
