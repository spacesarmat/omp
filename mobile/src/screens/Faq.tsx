import { useState } from 'preact/hooks';
import { Icon } from '../ui/Icon';
import { goBack } from '../nav';
import { FAQ } from '../faq';

export function Faq() {
  // one answer open at a time
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div class="m-screen" data-route="faq">
      <div class="m-bar">
        <button type="button" class="m-icon-btn" aria-label="Назад" onClick={() => goBack()}>
          <Icon d="M15 5l-7 7 7 7" />
        </button>
        <h1 class="m-bar-title">Вопросы и ответы</h1>
      </div>
      {FAQ.map((sec) => (
        <section class="m-set-group" key={sec.title}>
          <div class="m-set-label">{sec.title}</div>
          <div class="m-faq-list">
            {sec.items.map((it) => {
              const id = sec.title + '/' + it.q;
              const isOpen = open === id;
              return (
                <div class={'m-faq-item' + (isOpen ? ' open' : '')} key={id}>
                  <button type="button" class="m-faq-q" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
                    <span>{it.q}</span>
                    <Icon d={isOpen ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} size={18} />
                  </button>
                  {isOpen && (
                    <div class="m-faq-a">
                      {it.a.map((l, i) =>
                        typeof l === 'string' ? (
                          <p key={i}>{l}</p>
                        ) : (
                          <p key={i}>
                            <button type="button" class="m-link" onClick={() => window.open(l.url, '_system')}>
                              {l.text}
                            </button>
                          </p>
                        ),
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
