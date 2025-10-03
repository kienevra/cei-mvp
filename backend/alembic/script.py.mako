<%!
from alembic import op
import sqlalchemy as sa
%>
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | none}
Create Date: ${create_date}

"""
revision = '${up_revision}'
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}

def upgrade():
    ${upgrades if upgrades else "pass"}


def downgrade():
    ${downgrades if downgrades else "pass"}
