# Platform Owner Guide

Version: 1.0  
Audience: Platform owners  
Purpose: Help platform owners manage customers, workspaces, and top-level access safely

## What a platform owner is

Platform owner is the app-level administrator.

Platform owner can:

- create workspaces
- add members to any customer workspace
- add another platform owner
- update workspace roles
- change purchased modules
- change finance permissions
- disable workspaces
- delete workspaces
- delete app users

Platform owner operates across the product. Workspace owner only controls one workspace.

## Core responsibilities

As platform owner, your job is to:

- create customer workspaces cleanly
- assign the correct first users
- keep roles and access consistent
- help customers when their workspace structure becomes messy
- keep platform-owner access limited to trusted admins

## Creating a workspace

When creating a workspace:

1. create the workspace
2. choose the first customer user
3. assign the correct base workspace role
4. enable the correct modules
5. assign the correct finance permissions

Do not treat every customer as a platform owner. In most cases they should be:

- workspace owner
- manager
- or member

## Recommended first-user setup

For most customers, the first user should be:

- workspace role: Owner
- modules: Finance and/or Warehouse depending on what the customer bought
- finance permissions: only if needed

## Adding customer members

When adding members to a workspace, think in layers:

1. base workspace role
   - Owner
   - Manager
   - Member
2. purchased modules
   - Finance
   - Warehouse
3. finance permissions
   - Viewer
   - Approver
   - Finance staff
   - Accountant

This is the safest and clearest way to structure access.

## Adding another platform owner

Only add another platform owner when that person truly needs app-wide control.

A platform owner should only be someone who needs to:

- manage many customer workspaces
- troubleshoot customer access at the platform level
- manage workspace lifecycle and app-level administration

Do not use platform owner for normal customer admins.

## Disabling a workspace

Disable a workspace when you need to block customer access temporarily without deleting the workspace.

Use disable when:

- billing or commercial issues need temporary restriction
- the workspace should remain in the system
- you may want to re-enable it later

## Deleting a workspace

Delete a workspace only when the customer workspace and its data should be permanently removed.

Before deleting, confirm:

- the correct workspace was selected
- the customer understands this is permanent
- the workspace name was verified in the confirmation prompt

Delete should be used rarely.

## Deleting a user

Platform owner can delete a user from the app, but this is a dangerous action.

Use it only when:

- the account should be permanently removed
- the user is no longer needed in the system
- you have confirmed the exact email

The system protects:

- the last remaining platform owner
- self-delete from the platform-owner admin flow

## Safe access management rules

Good platform-owner habits:

- keep the number of platform owners small
- give customers workspace ownership, not platform ownership
- use Member as the base role when possible
- add modules and finance permissions only where needed
- remove unused access quickly

## Owner, manager, and member in customer terms

### Workspace owner

Use for the main customer admin inside one workspace.

### Manager

Use for operational leads who help run the workspace but do not own it.

### Member

Use for normal team members whose real access is controlled by modules and finance permissions.

## Finance permission meaning

### Viewer

Read-only finance access.

### Approver

Approval-focused finance access.

### Finance staff

Daily finance operations.

### Accountant

Deeper accounting and accounting-focused reporting.

## Troubleshooting customer access

If a customer says they cannot use the workspace correctly, check:

1. are they in the right workspace?
2. is their workspace access enabled?
3. is their base workspace role correct?
4. are the correct modules enabled?
5. are the right finance permissions enabled?

## Recommended platform-owner checklist

When provisioning or reviewing a customer workspace:

1. confirm workspace name and slug
2. confirm the right owner
3. confirm managers are limited
4. confirm members only have the modules they need
5. confirm finance permissions are minimal and intentional
6. confirm old users are removed if no longer needed

## What not to do

Avoid:

- giving customer users platform-owner access unless absolutely necessary
- using owner for every member
- enabling both modules for everyone by default
- giving accountant access too widely
- deleting workspaces when disable is enough

## Short explanation you can tell internal admins

> Platform owner manages the product across customers. Workspace owner manages one customer workspace. Keep those two levels separate so the system stays understandable and secure.
