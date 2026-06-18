"""add partner_name to organization + PartnerInvite table
Revision ID: a1b2c3d4e5f6
Revises: 78774ba49889
Create Date: 2026-06-18
"""
from alembic import op
import sqlalchemy as sa

revision    = "a1b2c3d4e5f6"
down_revision = "78774ba49889"
branch_labels = None
depends_on    = None


def upgrade() -> None:
    # ── 1. Add partner_name to organization ──────────────────────────────
    with op.batch_alter_table("organization", schema=None) as batch_op:
        batch_op.add_column(sa.Column(
            "partner_name",
            sa.String(length=255),
            nullable=True,
            comment="Display name injected into co-branded PDF documents (commercialista studio name)",
        ))

    # ── 2. Create partner_invite table ───────────────────────────────────
    op.create_table(
        "partner_invite",
        sa.Column("id",               sa.Integer(),     nullable=False),
        sa.Column("managing_org_id",  sa.Integer(),     nullable=False,
                  comment="The commercialista org that generated this invite"),
        sa.Column("token",            sa.String(64),    nullable=False,
                  comment="URL-safe random token (64 hex chars)"),
        sa.Column("token_hash",       sa.String(64),    nullable=False,
                  comment="SHA-256 hash of token stored for lookup"),
        sa.Column("factory_name",     sa.String(255),   nullable=True,
                  comment="Pre-filled factory name shown on signup form"),
        sa.Column("factory_email",    sa.String(255),   nullable=True,
                  comment="Pre-filled email shown on signup form"),
        sa.Column("note",             sa.Text(),        nullable=True,
                  comment="Internal note from commercialista"),
        sa.Column("created_at",       sa.DateTime(timezone=True),
                  server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at",       sa.DateTime(timezone=True), nullable=False,
                  comment="Invite expires after this timestamp (default 30 days)"),
        sa.Column("used_at",          sa.DateTime(timezone=True), nullable=True,
                  comment="Set when factory completes signup"),
        sa.Column("used_by_org_id",   sa.Integer(),     nullable=True,
                  comment="The factory org created via this invite"),
        sa.Column("revoked_at",       sa.DateTime(timezone=True), nullable=True,
                  comment="Set if commercialista revokes before use"),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(
            ["managing_org_id"], ["organization.id"],
            name="fk_partner_invite_managing_org",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["used_by_org_id"], ["organization.id"],
            name="fk_partner_invite_used_by_org",
            ondelete="SET NULL",
        ),
    )
    op.create_index("ix_partner_invite_token_hash",    "partner_invite", ["token_hash"],    unique=True)
    op.create_index("ix_partner_invite_managing_org",  "partner_invite", ["managing_org_id"])
    op.create_index("ix_partner_invite_used_by_org",   "partner_invite", ["used_by_org_id"])


def downgrade() -> None:
    op.drop_index("ix_partner_invite_used_by_org",   table_name="partner_invite")
    op.drop_index("ix_partner_invite_managing_org",  table_name="partner_invite")
    op.drop_index("ix_partner_invite_token_hash",    table_name="partner_invite")
    op.drop_table("partner_invite")

    with op.batch_alter_table("organization", schema=None) as batch_op:
        batch_op.drop_column("partner_name")
