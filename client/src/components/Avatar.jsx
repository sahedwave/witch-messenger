export function Avatar({ user, size = "default" }) {
  const classes = ["avatar", size === "large" ? "avatar-large" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <span className={classes} style={{ backgroundColor: user.avatarColor }} aria-hidden="true">
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt={`${user.name} avatar`} />
      ) : (
        user.name.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}

