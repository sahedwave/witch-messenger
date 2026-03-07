import { useEffect, useState } from "react";

const initialState = {
  name: "",
  email: "",
  password: "",
  resetCode: "",
  securityCode: ""
};

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
  const [formState, setFormState] = useState(initialState);
  const [fieldErrors, setFieldErrors] = useState({});

  useEffect(() => {
    setFieldErrors({});
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

  const primaryLabel =
    mode === "login"
      ? "Login"
      : mode === "register"
        ? "Create account"
        : mode === "forgot"
          ? "Send reset code"
          : mode === "reset"
            ? "Reset password"
            : "Verify code";

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <span className="eyebrow">ALLIED</span>
        <h1>WITCH</h1>
        <p className="auth-copy">Internal workplace chat for fast team communication.</p>
        <p className="auth-copy">Created by S rahman from NE-09.</p>

        <div className="auth-switch">
          <button
            className={mode === "login" ? "is-active" : ""}
            type="button"
            onClick={() => onModeChange("login")}
          >
            Login
          </button>
          <button
            className={mode === "register" ? "is-active" : ""}
            type="button"
            onClick={() => onModeChange("register")}
          >
            Register
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          {mode === "register" ? (
            <label>
              <span>Name</span>
              <input
                name="name"
                type="text"
                placeholder="ForLon"
                value={formState.name}
                onChange={handleChange}
                required
              />
              {fieldErrors.name ? <small className="field-error">{fieldErrors.name}</small> : null}
            </label>
          ) : null}

          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              placeholder="fry@example.com"
              value={formState.email}
              onChange={handleChange}
              required
            />
            {fieldErrors.email ? <small className="field-error">{fieldErrors.email}</small> : null}
          </label>

          {mode === "twoFactor" ? (
            <label>
              <span>Security code</span>
              <input
                name="securityCode"
                type="text"
                placeholder="Enter 6-digit security code"
                value={formState.securityCode}
                onChange={handleChange}
                required
              />
              {fieldErrors.securityCode ? (
                <small className="field-error">{fieldErrors.securityCode}</small>
              ) : null}
            </label>
          ) : null}

          {mode === "reset" ? (
            <label>
              <span>Reset code</span>
              <input
                name="resetCode"
                type="text"
                placeholder="Enter 6-digit code"
                value={formState.resetCode}
                onChange={handleChange}
                required
              />
              {fieldErrors.resetCode ? (
                <small className="field-error">{fieldErrors.resetCode}</small>
              ) : null}
            </label>
          ) : null}

          {mode !== "forgot" && mode !== "twoFactor" ? (
            <label>
              <span>{mode === "reset" ? "New password" : "Password"}</span>
              <input
                name="password"
                type="password"
                placeholder="Use 8+ characters"
                value={formState.password}
                onChange={handleChange}
                required
                minLength={8}
              />
              <small className="field-hint">
                Use 8+ characters with at least one letter and one number.
              </small>
              {fieldErrors.password ? (
                <small className="field-error">{fieldErrors.password}</small>
              ) : null}
            </label>
          ) : null}

          {notice ? <p className="field-hint">{notice}</p> : null}
          {recoveryCode ? (
            <p className="field-hint">
              {mode === "twoFactor" ? "Local security code" : "Local reset code"}:{" "}
              <strong>{recoveryCode}</strong>
            </p>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}

          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? "Please wait..." : primaryLabel}
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
      </div>
    </div>
  );
}
