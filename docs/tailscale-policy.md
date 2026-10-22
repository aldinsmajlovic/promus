# Tailscale access policy

This page is for the [private setup](self-hosting.md#private-on-your-tailnet), and for [Proxmox](proxmox.md), where the server is tagged `tag:promus`. It isn't required: the app has its own login whatever the network policy is. It limits the damage if a device or the server is ever compromised.

The target policy:
- Your own devices keep reaching each other on every port, as they do under allow-all.
- Your devices reach the server on `tcp:443` only, which is the HTTPS port that `tailscale serve` listens on.
- Home Assistant reaches the server on `tcp:443`, if its device is tagged. A Home Assistant node logged in as a user is already covered by the first two rules.
- The server reaches nothing. No grant has `tag:promus` as `src`. Grants are directional, so letting your devices connect to the server doesn't let the server connect to them. A compromised container can't reach Proxmox or anything else on the tailnet.

## First, list what allow-all was covering

`autogroup:member` covers only devices logged in as a user, and only their Tailscale addresses. Removing the allow-all rule cuts off, unless a grant covers them:
- **Tagged devices**, such as other servers or a tagged Home Assistant.
- **Subnet routes and exit nodes** that your devices advertise. A grant to the router device doesn't cover the networks behind it, or the internet through it.

On the **Machines** page of the admin console:
- Each device shows its tags.
- The **Subnets** and **Exit Node** badges mark routers. The `property:subnet` and `property:exit-node` filters list them.

Or, from one of your devices with `jq` installed:

```sh
tailscale status --json | jq -r '(.Self, .Peer[]?) | select(.Tags or .PrimaryRoutes or .ExitNodeOption) | "\(.HostName) tags=\(.Tags // [] | join(",")) routes=\(.PrimaryRoutes // [] | join(",")) exit-node=\(.ExitNodeOption)"'
```

For each one, add a grant to the `grants` below. For example:

```jsonc
// Your devices may use exit nodes.
{"src": ["autogroup:member"], "dst": ["autogroup:internet"], "ip": ["*"]},
// Your devices reach a subnet that a router advertises. Use your route instead of this example range.
{"src": ["autogroup:member"], "dst": ["192.0.2.0/24"], "ip": ["*"]},
```

These forms come from Tailscale's [grant examples](https://tailscale.com/docs/reference/examples/grants) for exit nodes and its [subnet router docs](https://tailscale.com/docs/features/subnet-routers) for CIDR destinations.

## The policy

Open **Access controls** and change only these parts:
- Remove the allow-all rule. In the default policy it is the `acls` entry `{"action": "accept", "src": ["*"], "dst": ["*:*"]}`. In a policy written with grants it is `{"src": ["*"], "dst": ["*"], "ip": ["*"]}`. `acls` and `grants` can coexist and both apply, so check both.
- Keep your other sections, such as `ssh`, `nodeAttrs` and `groups`, as they are.

Then merge in the following. Replace `you@example.com` with your Tailscale login. If your Home Assistant isn't tagged, remove `tag:homeassistant` everywhere: its `tagOwners` line, its grant, its test and the `tag:homeassistant:8123` entry.

```jsonc
{
  "tagOwners": {
    "tag:promus": ["autogroup:admin"],
    "tag:homeassistant": ["autogroup:admin"],
  },

  "grants": [
    // Your devices reach each other on every port, as before.
    {"src": ["autogroup:member"], "dst": ["autogroup:member"], "ip": ["*"]},
    // Your devices reach Promus over HTTPS only.
    {"src": ["autogroup:member"], "dst": ["tag:promus"], "ip": ["tcp:443"]},
    // A tagged Home Assistant reaches Promus over HTTPS only.
    {"src": ["tag:homeassistant"], "dst": ["tag:promus"], "ip": ["tcp:443"]},
    // Add grants here for the tagged devices, subnet routes and exit nodes you listed above.
    // No grant has tag:promus as src: the server reaches nothing.
  ],

  "tests": [
    {
      "src": "you@example.com",
      "proto": "tcp",
      "accept": ["tag:promus:443", "you@example.com:22"],
      "deny": ["tag:promus:22", "tag:promus:8080"],
    },
    {
      "src": "tag:homeassistant",
      "proto": "tcp",
      "accept": ["tag:promus:443"],
      "deny": ["tag:promus:22"],
    },
    {
      "src": "tag:promus",
      "deny": ["you@example.com:22", "you@example.com:443", "tag:homeassistant:8123"],
    },
  ],
}
```

Tailscale runs the `tests` on every save and rejects the policy if one fails.

The syntax was checked against Tailscale's [policy file syntax](https://tailscale.com/kb/1337/policy-syntax) and [grants syntax](https://tailscale.com/docs/reference/syntax/grants) references:
- `autogroup:member` is valid as both `src` and `dst`.
- A test's `src` takes a user, a group, a tag or a host, not an autogroup. That's why the tests use your login.
- If several people use your tailnet and each should reach only their own devices, use `"dst": ["autogroup:self"]` in the first grant.

Afterwards:
- Open the app on your phone.
- Check that Home Assistant still syncs.
- Check that every tagged device, subnet route and exit node you listed still works.

On Proxmox, manage the container from the Proxmox console (`pct enter <id>`) from now on, because the tailnet allows only port 443 to it.
