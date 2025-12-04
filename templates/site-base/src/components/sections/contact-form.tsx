type Field = {
  label: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  options?: string[];
};

type Props = {
  title: string;
  subtitle?: string;
  fields: Field[];
  submitLabel: string;
  contactEmail?: string;
  reassurance?: string;
};

export const ContactForm = ({
  title,
  subtitle,
  fields = [],
  submitLabel,
  contactEmail,
  reassurance,
}: Props) => {
  const mailto = contactEmail ? `mailto:${contactEmail}` : undefined;
  return (
    <section className="bg-white px-6 py-14 text-slate-900 md:px-12 md:py-20">
      <div className="mx-auto grid max-w-6xl gap-10 rounded-3xl bg-gradient-to-r from-white via-white to-blue-50 p-8 shadow-lg shadow-slate-900/5 md:grid-cols-2 md:p-12">
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-slate-500">Contact</p>
          <h2 className="text-3xl font-semibold leading-tight md:text-4xl">{title}</h2>
          {subtitle ? <p className="text-base text-slate-600">{subtitle}</p> : null}
          {reassurance ? (
            <div className="mt-2 rounded-2xl bg-white/80 p-4 text-sm text-slate-700 shadow-sm">
              {reassurance}
            </div>
          ) : null}
          {contactEmail ? (
            <a
              className="mt-4 inline-flex w-fit items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:shadow-xl"
              href={mailto}
            >
              Email us directly
            </a>
          ) : null}
        </div>
        <form
          className="flex flex-col gap-4 rounded-2xl bg-white/80 p-6 shadow-inner shadow-slate-200"
          action={mailto}
          method="POST"
          onSubmit={(e) => {
            if (!mailto) {
              e.preventDefault();
            }
          }}
        >
          {fields.map((field, idx) => {
            const name = field.label?.toLowerCase().replace(/\s+/g, '-');
            const options = Array.isArray(field.options) ? field.options : [];
            if ((field.type === 'radio' || field.type === 'checkbox') && options.length) {
              return (
                <fieldset key={field.label || idx} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 shadow-sm">
                  <legend className="text-sm font-semibold text-slate-900">{field.label}</legend>
                  <div className="flex flex-wrap gap-3">
                    {options.map((option) => (
                      <label key={option} className="inline-flex items-center gap-2 text-slate-700">
                        <input
                          type={field.type}
                          name={name}
                          value={option}
                          required={field.required}
                          className="h-4 w-4 accent-slate-900"
                        />
                        <span>{option}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              );
            }
            return (
              <label key={field.label || idx} className="flex flex-col gap-2 text-sm font-medium text-slate-800">
                <span>{field.label}</span>
                {field.type === 'textarea' ? (
                  <textarea
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    placeholder={field.placeholder}
                    required={field.required}
                    rows={4}
                    name={name}
                  />
                ) : (
                  <input
                    className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 shadow-sm focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
                    placeholder={field.placeholder}
                    required={field.required}
                    type={field.type || 'text'}
                    name={name}
                  />
                )}
              </label>
            );
          })}
          <button
            type={mailto ? 'submit' : 'button'}
            className="mt-2 inline-flex items-center justify-center rounded-full bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:shadow-xl"
          >
            {submitLabel || 'Send message'}
          </button>
          {!mailto ? (
            <p className="text-xs text-slate-500">
              Configure contactEmail to enable direct email submissions, or wire this form to your preferred handler.
            </p>
          ) : null}
        </form>
      </div>
    </section>
  );
};
