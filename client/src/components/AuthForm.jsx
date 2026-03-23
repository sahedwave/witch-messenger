import { useEffect, useMemo, useRef, useState } from "react";

import { AuthField, VisibilityButton } from "./AuthField";
import { FloatingGlassOrbs } from "./FloatingGlassOrbs";
import { GlassRippleSurface } from "./GlassRippleSurface";
import { HangingLight } from "./HangingLight";
import "../styles/auth-ui.css";

const initialState = {
  name: "",
  email: "",
  password: "",
  resetCode: "",
  securityCode: ""
};

const authContexts = {
  login: {
    cardTitle: "Login",
    cardCopy: "Welcome back. Sign in to continue your conversation with a calmer, premium workspace feel.",
    heroTitle: "",
    heroCopy: ""
  },
  register: {
    cardTitle: "Create account",
    cardCopy: "Start with a secure profile and bring your team into a more refined communication space.",
    heroTitle: "A polished first impression matters",
    heroCopy:
      "WITCH is designed to feel modern and trustworthy from the first screen, without losing clarity or everyday usability."
  },
  forgot: {
    cardTitle: "Recover access",
    cardCopy: "Request a reset code and move back into the workspace without losing your chat history.",
    heroTitle: "Recovery should feel guided",
    heroCopy:
      "Every recovery step keeps the same visual language so the experience stays confident, clear, and friction-light."
  },
  reset: {
    cardTitle: "Reset password",
    cardCopy: "Choose a new password and restore access to your account with a safer, smoother flow.",
    heroTitle: "Secure entry, reduced friction",
    heroCopy:
      "The interface stays tactile and precise while still making security steps easy to complete."
  },
  twoFactor: {
    cardTitle: "Verify code",
    cardCopy: "Enter the security code to confirm your identity and finish the sign-in process.",
    heroTitle: "Protected, without feeling heavy",
    heroCopy:
      "Security layers are integrated into the same visual system so the product feels consistent instead of interrupted."
  }
};

const authChips = ["Realtime sync", "Message requests", "2-step sign-in"];

function getPasswordStrength(password) {
  if (!password) {
    return {
      label: "Password strength",
      level: 0
    };
  }

  let score = 0;

  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (/[a-z]/i.test(password) && /\d/.test(password)) score += 1;
  if (/[^a-z0-9]/i.test(password)) score += 1;

  if (score <= 1) {
    return { label: "Weak", level: 1 };
  }

  if (score === 2) {
    return { label: "Fair", level: 2 };
  }

  if (score === 3) {
    return { label: "Strong", level: 3 };
  }

  return { label: "Excellent", level: 4 };
}

function validateForm(mode, values) {
  const nextErrors = {};

  if (mode === "register") {
    if (!values.name.trim()) {
      nextErrors.name = "Name is required.";
    } else if (values.name.trim().length < 2) {
      nextErrors.name = "Name must be at least 2 characters.";
    } else if (values.name.trim().length > 40) {
      nextErrors.name = "Name must be 40 characters or fewer.";
    }
  }

  if (!values.email.trim()) {
    nextErrors.email = "Email is required.";
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
    nextErrors.email = "Enter a valid email address.";
  }

  if (mode === "forgot") {
    return nextErrors;
  }

  if (mode === "twoFactor") {
    if (!values.securityCode.trim()) {
      nextErrors.securityCode = "Security code is required.";
    }

    return nextErrors;
  }

  if (!values.password) {
    nextErrors.password = mode === "reset" ? "New password is required." : "Password is required.";
  } else if (values.password.length < 8) {
    nextErrors.password = "Password must be at least 8 characters.";
  } else if (!/[a-z]/i.test(values.password) || !/\d/.test(values.password)) {
    nextErrors.password = "Password needs at least one letter and one number.";
  }

  if (mode === "reset" && !values.resetCode.trim()) {
    nextErrors.resetCode = "Reset code is required.";
  }

  return nextErrors;
}

export function AuthForm({
  mode,
  notice,
  onModeChange,
  onSubmit,
  loading,
  error,
  recoveryCode
}) {
  const shellRef = useRef(null);
  const [formState, setFormState] = useState(initialState);
  const [fieldErrors, setFieldErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [cardLens, setCardLens] = useState({
    active: false,
    rotateX: 0,
    rotateY: 0,
    x: 50,
    y: 50
  });

  useEffect(() => {
    setFieldErrors({});
    setShowPassword(false);
    setFormState((current) => ({
      ...initialState,
      email: current.email
    }));
  }, [mode]);

  function handleChange(event) {
    const { name, value } = event.target;
    const nextState = {
      ...formState,
      [name]: value
    };

    setFormState(nextState);
    setFieldErrors(validateForm(mode, nextState));
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const nextErrors = validateForm(mode, formState);
    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    await onSubmit({
      ...formState,
      name: formState.name.trim(),
      email: formState.email.trim(),
      resetCode: formState.resetCode.trim(),
      securityCode: formState.securityCode.trim()
    });

    setFormState((current) => ({
      ...current,
      password: "",
      resetCode: mode === "forgot" ? current.resetCode : "",
      securityCode: ""
    }));
  }

  const context = authContexts[mode];
  const primaryLabel = context.cardTitle;
  const passwordStrength = getPasswordStrength(formState.password);
  const primaryToggleMode = mode === "register" ? "register" : "login";
  const switchIndicatorStyle = useMemo(
    () => ({
      transform: primaryToggleMode === "register" ? "translateX(100%)" : "translateX(0)"
    }),
    [primaryToggleMode]
  );
  const cardStyle = useMemo(
    () => ({
      "--card-rotate-x": `${cardLens.rotateX}deg`,
      "--card-rotate-y": `${cardLens.rotateY}deg`,
      "--card-glow-x": `${cardLens.x}%`,
      "--card-glow-y": `${cardLens.y}%`
    }),
    [cardLens]
  );

  function handleCardPointerMove(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    const rotateY = ((x - 50) / 50) * 4.5;
    const rotateX = ((50 - y) / 50) * 4.5;

    setCardLens({
      active: true,
      rotateX,
      rotateY,
      x,
      y
    });
  }

  function resetCardLens() {
    setCardLens((current) => ({
      ...current,
      active: false,
      rotateX: 0,
      rotateY: 0,
      x: 50,
      y: 50
    }));
  }

  return (
    <div ref={shellRef} className="auth-shell auth-shell-glass">
      <FloatingGlassOrbs />
      <HangingLight surfaceRef={shellRef} />

      <main className="auth-stage">
        <section className="auth-hero" aria-labelledby="auth-hero-title">
          <div className="auth-hero-topline">
            <span className="eyebrow">ALLIED</span>
            <span className="auth-hero-rule" aria-hidden="true" />
          </div>

          <h1 id="auth-hero-title">WITCH</h1>
          {context.heroTitle ? <h2 className="auth-hero-subtitle">{context.heroTitle}</h2> : null}
          {context.heroCopy ? <p className="auth-copy auth-copy-lead">{context.heroCopy}</p> : null}
          <p className="auth-copy">Created by S rahman from NE-09.</p>
          <div className="auth-chip-row" aria-label="Product highlights">
            {authChips.map((chip) => (
              <span key={chip} className="auth-chip">
                {chip}
              </span>
            ))}
          </div>

          <GlassRippleSurface
            title="Touch the surface"
            description="Press, drag, or tap here to create smooth water waves moving through the glass."
          />
        </section>

        <section
          className={`auth-card auth-card-glass ${cardLens.active ? "is-tilting" : ""}`}
          aria-labelledby="auth-card-title"
          style={cardStyle}
          onPointerMove={handleCardPointerMove}
          onPointerLeave={resetCardLens}
          onPointerUp={resetCardLens}
        >
          <span className="auth-card-lightwash" aria-hidden="true" />
          <span className="auth-card-refraction" aria-hidden="true" />
          <header className="auth-card-header">
            <span className="eyebrow">Secure Entry</span>
            <h2 id="auth-card-title">{primaryLabel}</h2>
            <p className="auth-copy">{context.cardCopy}</p>
          </header>

          <div className="auth-switch" role="tablist" aria-label="Authentication mode">
            <span className="auth-switch-indicator" style={switchIndicatorStyle} aria-hidden="true" />
            <button
              className={primaryToggleMode === "login" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={primaryToggleMode === "login"}
              onClick={() => onModeChange("login")}
            >
              Login
            </button>
            <button
              className={primaryToggleMode === "register" ? "is-active" : ""}
              type="button"
              role="tab"
              aria-selected={primaryToggleMode === "register"}
              onClick={() => onModeChange("register")}
            >
              Register
            </button>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            {mode === "register" ? (
              <AuthField
                label="Name"
                name="name"
                type="text"
                icon="user"
                placeholder="ForLon"
                value={formState.name}
                onChange={handleChange}
                error={fieldErrors.name}
                autoComplete="name"
                required
              />
            ) : null}

            <AuthField
              label="Email"
              name="email"
              type="email"
              icon="mail"
              placeholder="fry@example.com"
              value={formState.email}
              onChange={handleChange}
              error={fieldErrors.email}
              autoComplete="email"
              required
            />

            {mode === "twoFactor" ? (
              <AuthField
                label="Security code"
                name="securityCode"
                type="text"
                icon="shield"
                placeholder="Enter 6-digit security code"
                value={formState.securityCode}
                onChange={handleChange}
                error={fieldErrors.securityCode}
                inputMode="numeric"
                required
              />
            ) : null}

            {mode === "reset" ? (
              <AuthField
                label="Reset code"
                name="resetCode"
                type="text"
                icon="shield"
                placeholder="Enter 6-digit code"
                value={formState.resetCode}
                onChange={handleChange}
                error={fieldErrors.resetCode}
                inputMode="numeric"
                required
              />
            ) : null}

            {mode !== "forgot" && mode !== "twoFactor" ? (
              <AuthField
                label={mode === "reset" ? "New password" : "Password"}
                name="password"
                type={showPassword ? "text" : "password"}
                icon="lock"
                placeholder="Use 8+ characters"
                value={formState.password}
                onChange={handleChange}
                error={fieldErrors.password}
                hint="Use 8+ characters with at least one letter and one number."
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                action={<VisibilityButton open={showPassword} onClick={() => setShowPassword((current) => !current)} />}
                required
                minLength={8}
              />
            ) : null}

            {mode !== "forgot" && mode !== "twoFactor" ? (
              <div className="auth-strength" aria-live="polite">
                <div className="auth-strength-bar" role="presentation">
                  {[0, 1, 2, 3].map((index) => (
                    <span
                      key={index}
                      className={index < passwordStrength.level ? "is-active" : ""}
                    />
                  ))}
                </div>
                <span className={`auth-strength-label level-${passwordStrength.level}`}>
                  {passwordStrength.label}
                </span>
              </div>
            ) : null}

            {notice ? <p className="auth-feedback is-notice">{notice}</p> : null}
            {recoveryCode ? (
              <p className="auth-feedback is-success auth-recovery-code">
                {mode === "twoFactor" ? "Local security code" : "Local reset code"}:{" "}
                <strong>{recoveryCode}</strong>
              </p>
            ) : null}
            {error ? <p className="auth-feedback is-error">{error}</p> : null}

            <button className="primary-button auth-submit-button" type="submit" disabled={loading}>
              <span>{loading ? "Please wait..." : primaryLabel}</span>
            </button>

            <div className="auth-links">
              {mode === "login" ? (
                <button className="auth-link-button" type="button" onClick={() => onModeChange("forgot")}>
                  Forgot password?
                </button>
              ) : null}
              {mode === "forgot" ? (
                <button className="auth-link-button" type="button" onClick={() => onModeChange("reset")}>
                  I already have a reset code
                </button>
              ) : null}
              {mode === "reset" ? (
                <button className="auth-link-button" type="button" onClick={() => onModeChange("login")}>
                  Back to login
                </button>
              ) : null}
              {mode === "twoFactor" ? (
                <button className="auth-link-button" type="button" onClick={() => onModeChange("login")}>
                  Cancel login
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
