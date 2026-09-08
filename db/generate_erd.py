"""
Generate draw.io ERD for Forge Platform (54 tables, 15 domains).
Run: python db/generate_erd.py
Output: docs/Forge_ERD.drawio      (native draw.io XML — open in draw.io desktop)
        docs/Forge_ERD.drawio.html (browser viewer — open in any browser)
"""
import json
import os
from xml.sax.saxutils import escape as xml_escape

# ─── Domain definitions with colors ────────────────────────────────────────
DOMAINS = [
    {"id": "d1",  "name": "1. Identity & Auth",      "color": "#dae8fc", "stroke": "#6c8ebf"},
    {"id": "d2",  "name": "2. PT Modes & Hierarchy",  "color": "#d5e8d4", "stroke": "#82b366"},
    {"id": "d3",  "name": "3. Coaching",              "color": "#fff2cc", "stroke": "#d6b656"},
    {"id": "d4",  "name": "4. Gym",                   "color": "#f8cecc", "stroke": "#b85450"},
    {"id": "d5",  "name": "5. Programming",           "color": "#e1d5e7", "stroke": "#9673a6"},
    {"id": "d6",  "name": "6. Logging & Sessions",    "color": "#d5e8d4", "stroke": "#82b366"},
    {"id": "d7",  "name": "7. Nutrition",             "color": "#fff2cc", "stroke": "#d6b656"},
    {"id": "d8",  "name": "8. Scheduling & Bookings", "color": "#dae8fc", "stroke": "#6c8ebf"},
    {"id": "d9",  "name": "9. Billing & Subscriptions","color": "#f8cecc","stroke": "#b85450"},
    {"id": "d10", "name": "10. AI",                   "color": "#e1d5e7", "stroke": "#9673a6"},
    {"id": "d11", "name": "11. Communication",        "color": "#dae8fc", "stroke": "#6c8ebf"},
    {"id": "d12", "name": "12. Form-Check Video",     "color": "#d5e8d4", "stroke": "#82b366"},
    {"id": "d13", "name": "13. Notifications",        "color": "#fff2cc", "stroke": "#d6b656"},
    {"id": "d14", "name": "14. Gamification",         "color": "#f8cecc", "stroke": "#b85450"},
    {"id": "d15", "name": "15. Marketplace (v2/v3)",  "color": "#e1d5e7", "stroke": "#9673a6"},
]

# ─── Table definitions: (id, name, domain_idx, columns_to_show) ───────────
# Columns format: [(name, type, flags)]  flags: PK, FK, UL (ULID PK)
TABLES = [
    # Domain 1: Identity
    ("users", "users", 0, [
        ("id", "UUID", "PK"), ("role", "VARCHAR", ""), ("email", "CITEXT", "UQ"),
        ("display_name", "VARCHAR", ""), ("auth_provider", "VARCHAR", ""),
        ("mfa_enabled", "BOOL", ""), ("is_deleted", "BOOL", ""),
    ]),
    ("user_sessions", "user_sessions", 0, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("refresh_token_hash", "VARCHAR", ""), ("family_id", "UUID", ""),
        ("expires_at", "TIMESTAMPTZ", ""),
    ]),
    ("device_tokens", "device_tokens", 0, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("platform", "VARCHAR", ""), ("token", "TEXT", ""),
    ]),
    ("audit_logs", "audit_logs", 0, [
        ("id", "UUID", "PK"), ("actor_id", "UUID", "FK"),
        ("target_user_id", "UUID", "FK"), ("action", "VARCHAR", ""),
        ("entity_type", "VARCHAR", ""), ("details", "JSONB", ""),
    ]),

    # Domain 2: PT Modes
    ("pt_profiles", "pt_profiles", 1, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("slug", "VARCHAR", "UQ"), ("certifications", "TEXT[]", ""),
        ("specializations", "TEXT[]", ""),
    ]),
    ("pt_modes", "pt_modes", 1, [
        ("id", "UUID", "PK"), ("pt_user_id", "UUID", "FK"),
        ("mode", "VARCHAR", ""), ("master_id", "UUID", "FK"),
        ("is_active", "BOOL", ""),
    ]),
    ("master_sub_relations", "master_sub_relations", 1, [
        ("id", "UUID", "PK"), ("master_pt_id", "UUID", "FK"),
        ("sub_pt_id", "UUID", "FK"), ("state", "VARCHAR", ""),
    ]),

    # Domain 3: Coaching
    ("clients", "clients", 2, [
        ("id", "UUID", "PK"), ("pt_user_id", "UUID", "FK"),
        ("client_user_id", "UUID", "FK"), ("pt_mode_id", "UUID", "FK"),
        ("gym_id", "UUID", "FK"), ("state", "VARCHAR", ""),
    ]),
    ("client_pt_assignments", "client_pt_assignments", 2, [
        ("id", "UUID", "PK"), ("client_id", "UUID", "FK"),
        ("pt_user_id", "UUID", "FK"), ("master_user_id", "UUID", "FK"),
        ("is_active", "BOOL", ""),
    ]),
    ("intake_forms", "intake_forms", 2, [
        ("id", "UUID", "PK"), ("client_id", "UUID", "FK"),
        ("state", "VARCHAR", ""), ("responses", "JSONB", ""),
    ]),

    # Domain 4: Gym
    ("gyms", "gyms", 3, [
        ("id", "UUID", "PK"), ("owner_user_id", "UUID", "FK"),
        ("name", "VARCHAR", ""), ("slug", "VARCHAR", "UQ"),
        ("location", "GEOGRAPHY", ""),
    ]),
    ("gym_memberships", "gym_memberships", 3, [
        ("id", "UUID", "PK"), ("pt_user_id", "UUID", "FK"),
        ("gym_id", "UUID", "FK"), ("state", "VARCHAR", ""),
    ]),
    ("gym_clients", "gym_clients", 3, [
        ("id", "UUID", "PK"), ("gym_id", "UUID", "FK"),
        ("client_name", "VARCHAR", ""), ("is_active", "BOOL", ""),
    ]),

    # Domain 5: Programming
    ("exercises", "exercises", 4, [
        ("id", "UUID", "PK"), ("name", "VARCHAR", ""),
        ("muscle_group", "VARCHAR", ""), ("equipment", "VARCHAR", ""),
        ("is_custom", "BOOL", ""), ("created_by_user_id", "UUID", "FK"),
    ]),
    ("programs", "programs", 4, [
        ("id", "UUID", "PK"), ("author_user_id", "UUID", "FK"),
        ("client_id", "UUID", "FK"), ("state", "VARCHAR", ""),
        ("is_template", "BOOL", ""), ("ai_generation_id", "UUID", "FK"),
    ]),
    ("program_weeks", "program_weeks", 4, [
        ("id", "UUID", "PK"), ("program_id", "UUID", "FK"),
        ("week_number", "SMALLINT", ""),
    ]),
    ("program_days", "program_days", 4, [
        ("id", "UUID", "PK"), ("week_id", "UUID", "FK"),
        ("day_number", "SMALLINT", ""),
    ]),
    ("program_blocks", "program_blocks", 4, [
        ("id", "UUID", "PK"), ("day_id", "UUID", "FK"),
        ("block_type", "VARCHAR", ""), ("sort_order", "SMALLINT", ""),
    ]),
    ("program_exercises", "program_exercises", 4, [
        ("id", "UUID", "PK"), ("block_id", "UUID", "FK"),
        ("exercise_id", "UUID", "FK"), ("target_rpe", "NUMERIC", ""),
    ]),

    # Domain 6: Logging
    ("workout_sessions", "workout_sessions", 5, [
        ("id", "UUID", "PK"), ("client_id", "UUID", "FK"),
        ("logged_by_user_id", "UUID", "FK"), ("program_day_id", "UUID", "FK"),
        ("booking_id", "UUID", "FK"), ("gym_id", "UUID", "FK"),
        ("status", "VARCHAR", ""),
    ]),
    ("sets", "sets", 5, [
        ("id", "CHAR(26)", "UL"), ("workout_session_id", "UUID", "FK"),
        ("exercise_id", "UUID", "FK"), ("weight_kg", "NUMERIC", ""),
        ("reps", "SMALLINT", ""), ("rpe", "NUMERIC", ""),
        ("is_synced", "BOOL", ""),
    ]),
    ("exercise_prs", "exercise_prs", 5, [
        ("id", "UUID", "PK"), ("client_id", "UUID", "FK"),
        ("exercise_id", "UUID", "FK"), ("pr_type", "VARCHAR", ""),
        ("value", "NUMERIC", ""),
    ]),
    ("body_metrics", "body_metrics", 5, [
        ("id", "UUID", "PK"), ("client_id", "UUID", "FK"),
        ("weight_kg", "NUMERIC", ""), ("body_fat_pct", "NUMERIC", ""),
    ]),
    ("progress_photos", "progress_photos", 5, [
        ("id", "UUID", "PK"), ("client_id", "UUID", "FK"),
        ("photo_url", "TEXT", ""), ("is_shared_with_pt", "BOOL", ""),
    ]),

    # Domain 7: Nutrition
    ("meal_plans", "meal_plans", 6, [
        ("id", "UUID", "PK"), ("client_id", "UUID", "FK"),
        ("author_user_id", "UUID", "FK"), ("state", "VARCHAR", ""),
        ("target_calories", "SMALLINT", ""),
    ]),
    ("food_items", "food_items", 6, [
        ("id", "UUID", "PK"), ("name", "VARCHAR", ""),
        ("barcode", "VARCHAR", "UQ"), ("calories_per_serving", "NUMERIC", ""),
        ("source", "VARCHAR", ""),
    ]),
    ("food_logs", "food_logs", 6, [
        ("id", "UUID", "PK"), ("client_id", "UUID", "FK"),
        ("food_item_id", "UUID", "FK"), ("meal_type", "VARCHAR", ""),
        ("logged_date", "DATE", ""),
    ]),

    # Domain 8: Scheduling
    ("schedules", "schedules", 7, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("day_of_week", "SMALLINT", ""), ("start_time", "TIME", ""),
        ("gym_id", "UUID", "FK"),
    ]),
    ("bookings", "bookings", 7, [
        ("id", "UUID", "PK"), ("pt_user_id", "UUID", "FK"),
        ("client_id", "UUID", "FK"), ("class_id", "UUID", "FK"),
        ("gym_id", "UUID", "FK"), ("status", "VARCHAR", ""),
        ("starts_at", "TIMESTAMPTZ", ""),
    ]),
    ("check_ins", "check_ins", 7, [
        ("id", "UUID", "PK"), ("booking_id", "UUID", "FK"),
        ("check_in_method", "VARCHAR", ""), ("rating", "SMALLINT", ""),
    ]),
    ("classes", "classes", 7, [
        ("id", "UUID", "PK"), ("pt_user_id", "UUID", "FK"),
        ("gym_id", "UUID", "FK"), ("name", "VARCHAR", ""),
        ("capacity", "SMALLINT", ""),
    ]),

    # Domain 9: Billing
    ("subscriptions", "subscriptions", 8, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("product", "VARCHAR", ""), ("status", "VARCHAR", ""),
        ("price_cents", "INT", ""), ("billing_interval", "VARCHAR", ""),
    ]),
    ("subscription_addons", "subscription_addons", 8, [
        ("id", "UUID", "PK"), ("subscription_id", "UUID", "FK"),
        ("addon_type", "VARCHAR", ""), ("quantity", "SMALLINT", ""),
    ]),
    ("charges", "charges", 8, [
        ("id", "UUID", "PK"), ("subscription_id", "UUID", "FK"),
        ("user_id", "UUID", "FK"), ("amount_cents", "INT", ""),
        ("status", "VARCHAR", ""),
    ]),
    ("ai_credit_wallets", "ai_credit_wallets", 8, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("balance", "INT", ""), ("total_purchased", "INT", ""),
    ]),
    ("ai_credit_packs", "ai_credit_packs", 8, [
        ("id", "UUID", "PK"), ("wallet_id", "UUID", "FK"),
        ("charge_id", "UUID", "FK"), ("tier", "VARCHAR", ""),
        ("credits", "SMALLINT", ""),
    ]),

    # Domain 10: AI
    ("ai_generations", "ai_generations", 9, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("generation_type", "VARCHAR", ""), ("model_id", "VARCHAR", ""),
        ("credits_charged", "SMALLINT", ""), ("was_refunded", "BOOL", ""),
    ]),

    # Domain 11: Communication
    ("messages", "messages", 10, [
        ("id", "UUID", "PK"), ("sender_user_id", "UUID", "FK"),
        ("message_type", "VARCHAR", ""), ("body", "TEXT", ""),
        ("thread_id", "UUID", "FK"),
    ]),
    ("message_recipients", "message_recipients", 10, [
        ("id", "UUID", "PK"), ("message_id", "UUID", "FK"),
        ("recipient_user_id", "UUID", "FK"), ("is_read", "BOOL", ""),
    ]),
    ("video_sessions", "video_sessions", 10, [
        ("id", "UUID", "PK"), ("booking_id", "UUID", "FK"),
        ("provider", "VARCHAR", ""), ("room_url", "TEXT", ""),
    ]),

    # Domain 12: Form-Check
    ("form_check_uploads", "form_check_uploads", 11, [
        ("id", "UUID", "PK"), ("client_id", "UUID", "FK"),
        ("exercise_id", "UUID", "FK"), ("upload_status", "VARCHAR", ""),
        ("review_status", "VARCHAR", ""),
    ]),
    ("form_check_comments", "form_check_comments", 11, [
        ("id", "UUID", "PK"), ("upload_id", "UUID", "FK"),
        ("author_user_id", "UUID", "FK"), ("timestamp_ms", "INT", ""),
        ("drawing_data", "JSONB", ""),
    ]),

    # Domain 13: Notifications
    ("notifications", "notifications", 12, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("channel", "VARCHAR", ""), ("category", "VARCHAR", ""),
        ("is_read", "BOOL", ""), ("is_delivered", "BOOL", ""),
    ]),
    ("notification_preferences", "notification_preferences", 12, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("channel", "VARCHAR", ""), ("category", "VARCHAR", ""),
        ("enabled", "BOOL", ""),
    ]),

    # Domain 14: Gamification
    ("streaks", "streaks", 13, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("streak_type", "VARCHAR", ""), ("current_count", "INT", ""),
        ("longest_count", "INT", ""),
    ]),
    ("badges", "badges", 13, [
        ("id", "UUID", "PK"), ("slug", "VARCHAR", "UQ"),
        ("name", "VARCHAR", ""), ("category", "VARCHAR", ""),
        ("criteria", "JSONB", ""),
    ]),
    ("user_badges", "user_badges", 13, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("badge_id", "UUID", "FK"), ("earned_at", "TIMESTAMPTZ", ""),
    ]),
    ("challenges", "challenges", 13, [
        ("id", "UUID", "PK"), ("created_by_user_id", "UUID", "FK"),
        ("challenge_type", "VARCHAR", ""), ("target_value", "NUMERIC", ""),
        ("starts_at", "TIMESTAMPTZ", ""),
    ]),
    ("challenge_participants", "challenge_participants", 13, [
        ("id", "UUID", "PK"), ("challenge_id", "UUID", "FK"),
        ("user_id", "UUID", "FK"), ("status", "VARCHAR", ""),
    ]),

    # Domain 15: Marketplace
    ("listings", "listings", 14, [
        ("id", "UUID", "PK"), ("gym_id", "UUID", "FK"),
        ("user_id", "UUID", "FK"), ("listing_type", "VARCHAR", ""),
        ("is_published", "BOOL", ""),
    ]),
    ("events", "events", 14, [
        ("id", "UUID", "PK"), ("gym_id", "UUID", "FK"),
        ("created_by_user_id", "UUID", "FK"), ("visibility", "VARCHAR", ""),
        ("capacity", "SMALLINT", ""),
    ]),
    ("tickets", "tickets", 14, [
        ("id", "UUID", "PK"), ("event_id", "UUID", "FK"),
        ("user_id", "UUID", "FK"), ("charge_id", "UUID", "FK"),
        ("ticket_code", "VARCHAR", "UQ"),
    ]),
    ("products", "products", 14, [
        ("id", "UUID", "PK"), ("name", "VARCHAR", ""),
        ("price_cents", "INT", ""), ("sku", "VARCHAR", "UQ"),
    ]),
    ("orders", "orders", 14, [
        ("id", "UUID", "PK"), ("user_id", "UUID", "FK"),
        ("charge_id", "UUID", "FK"), ("status", "VARCHAR", ""),
        ("total_cents", "INT", ""),
    ]),
]

# ─── Relationships: (source_table, target_table, label, card) ──────────────
# card: "1:N", "1:1", "N:1"
RELS = [
    # Domain 1
    ("users", "user_sessions", "1:N", "CASCADE"),
    ("users", "device_tokens", "1:N", "CASCADE"),
    ("users", "audit_logs", "1:N", "SET NULL"),
    # Domain 2
    ("users", "pt_profiles", "1:1", "CASCADE"),
    ("users", "pt_modes", "1:N", "CASCADE"),
    ("users", "master_sub_relations", "1:N", "CASCADE"),
    # Domain 3
    ("users", "clients", "1:N", "CASCADE"),
    ("clients", "client_pt_assignments", "1:N", "CASCADE"),
    ("clients", "intake_forms", "1:N", "CASCADE"),
    ("pt_modes", "clients", "1:N", "SET NULL"),
    # Domain 4
    ("users", "gyms", "1:N", "CASCADE"),
    ("users", "gym_memberships", "1:N", "CASCADE"),
    ("gyms", "gym_memberships", "1:N", "CASCADE"),
    ("gyms", "gym_clients", "1:N", "CASCADE"),
    ("gyms", "clients", "1:N", "SET NULL"),
    # Domain 5
    ("users", "programs", "1:N", "CASCADE"),
    ("clients", "programs", "1:N", "SET NULL"),
    ("programs", "program_weeks", "1:N", "CASCADE"),
    ("program_weeks", "program_days", "1:N", "CASCADE"),
    ("program_days", "program_blocks", "1:N", "CASCADE"),
    ("program_blocks", "program_exercises", "1:N", "CASCADE"),
    ("exercises", "program_exercises", "1:N", "RESTRICT"),
    # Domain 6
    ("clients", "workout_sessions", "1:N", "CASCADE"),
    ("program_days", "workout_sessions", "1:N", "SET NULL"),
    ("bookings", "workout_sessions", "1:1", "SET NULL"),
    ("gyms", "workout_sessions", "1:N", "SET NULL"),
    ("workout_sessions", "sets", "1:N", "APP"),
    ("exercises", "sets", "1:N", "APP"),
    ("clients", "exercise_prs", "1:N", "CASCADE"),
    ("exercises", "exercise_prs", "1:N", "CASCADE"),
    ("clients", "body_metrics", "1:N", "CASCADE"),
    ("clients", "progress_photos", "1:N", "CASCADE"),
    # Domain 7
    ("clients", "meal_plans", "1:N", "CASCADE"),
    ("clients", "food_logs", "1:N", "CASCADE"),
    ("food_items", "food_logs", "1:N", "SET NULL"),
    ("meal_plans", "food_logs", "1:N", "SET NULL"),
    # Domain 8
    ("users", "schedules", "1:N", "CASCADE"),
    ("users", "bookings", "1:N", "CASCADE"),
    ("clients", "bookings", "1:N", "SET NULL"),
    ("classes", "bookings", "1:N", "SET NULL"),
    ("gyms", "bookings", "1:N", "SET NULL"),
    ("bookings", "check_ins", "1:1", "CASCADE"),
    ("users", "classes", "1:N", "CASCADE"),
    ("gyms", "classes", "1:N", "SET NULL"),
    # Domain 9
    ("users", "subscriptions", "1:N", "CASCADE"),
    ("subscriptions", "subscription_addons", "1:N", "CASCADE"),
    ("subscriptions", "charges", "1:N", "SET NULL"),
    ("users", "charges", "1:N", "CASCADE"),
    ("users", "ai_credit_wallets", "1:1", "CASCADE"),
    ("ai_credit_wallets", "ai_credit_packs", "1:N", "CASCADE"),
    ("charges", "ai_credit_packs", "1:1", "SET NULL"),
    # Domain 10
    ("users", "ai_generations", "1:N", "CASCADE"),
    # Domain 11
    ("users", "messages", "1:N", "CASCADE"),
    ("messages", "message_recipients", "1:N", "CASCADE"),
    ("users", "message_recipients", "1:N", "CASCADE"),
    ("bookings", "video_sessions", "1:1", "CASCADE"),
    # Domain 12
    ("clients", "form_check_uploads", "1:N", "CASCADE"),
    ("exercises", "form_check_uploads", "1:N", "SET NULL"),
    ("form_check_uploads", "form_check_comments", "1:N", "CASCADE"),
    # Domain 13
    ("users", "notifications", "1:N", "CASCADE"),
    ("users", "notification_preferences", "1:N", "CASCADE"),
    # Domain 14
    ("users", "streaks", "1:N", "CASCADE"),
    ("users", "user_badges", "1:N", "CASCADE"),
    ("badges", "user_badges", "1:N", "CASCADE"),
    ("users", "challenges", "1:N", "CASCADE"),
    ("challenges", "challenge_participants", "1:N", "CASCADE"),
    ("users", "challenge_participants", "1:N", "CASCADE"),
    # Domain 15
    ("gyms", "listings", "1:N", "CASCADE"),
    ("gyms", "events", "1:N", "CASCADE"),
    ("events", "tickets", "1:N", "CASCADE"),
    ("users", "orders", "1:N", "CASCADE"),
]


def build_xml():
    """Build the mxGraphModel XML."""
    cells = []
    cell_id = 2  # 0 and 1 are reserved

    # ── Domain layout grid ──────────────────────────────────────────────
    # 5 columns x 3 rows, each domain cell ~680w
    COLS = 5
    COL_W = 700
    ROW_H_MAP = [620, 720, 580]  # row heights
    PADDING = 30
    TABLE_W = 190
    ROW_LINE_H = 22
    HEADER_H = 30

    # Map domain index to (col, row) positions
    domain_grid = [
        (0,0), (1,0), (2,0), (3,0), (4,0),   # Row 0: D1-D5
        (0,1), (1,1), (2,1), (3,1), (4,1),   # Row 1: D6-D10
        (0,2), (1,2), (2,2), (3,2), (4,2),   # Row 2: D11-D15
    ]

    domain_rects = {}  # domain_idx -> (x, y, w, h)
    domain_cell_ids = {}

    # Create domain containers
    for i, d in enumerate(DOMAINS):
        col, row = domain_grid[i]
        x = col * COL_W + PADDING
        y = sum(ROW_H_MAP[:row]) + PADDING * (row + 1)
        w = COL_W - PADDING * 2
        h = ROW_H_MAP[row] - PADDING
        domain_rects[i] = (x, y, w, h)
        did = cell_id
        domain_cell_ids[i] = did
        cell_id += 1
        cells.append(
            f'<mxCell id="{did}" value="{xml_escape(d["name"], {chr(34): "&quot;"})}" '
            f'style="rounded=1;whiteSpace=wrap;html=1;fillColor={d["color"]};strokeColor={d["stroke"]};'
            f'verticalAlign=top;fontStyle=1;fontSize=13;spacingTop=5;dashed=0;container=1;collapsible=0;" '
            f'vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/>'
            f'</mxCell>'
        )

    # ── Place tables inside domain containers ──────────────────────────
    table_cell_ids = {}   # table_id -> mxCell id
    table_positions = {}  # table_id -> (abs_x, abs_y, w, h) for arrow routing

    # Group tables by domain
    domain_tables = {}
    for t in TABLES:
        di = t[2]
        domain_tables.setdefault(di, []).append(t)

    for di, tbls in domain_tables.items():
        dx, dy, dw, dh = domain_rects[di]
        parent_id = domain_cell_ids[di]
        n = len(tbls)

        # Arrange tables in a grid within the domain container
        if n <= 2:
            t_cols = 2
        elif n <= 4:
            t_cols = 2
        elif n <= 6:
            t_cols = 3
        else:
            t_cols = 3

        margin_top = 35
        margin_left = 15
        gap_x = 15
        gap_y = 15
        avail_w = dw - margin_left * 2
        tw = min(TABLE_W, (avail_w - gap_x * (t_cols - 1)) // t_cols)

        for idx, tbl in enumerate(tbls):
            tid, tname, _, cols = tbl
            col_i = idx % t_cols
            row_i = idx // t_cols
            th = HEADER_H + len(cols) * ROW_LINE_H + 4

            # Position relative to domain container
            tx = margin_left + col_i * (tw + gap_x)
            ty = margin_top + row_i * (th + gap_y)

            # Absolute position (for arrow routing)
            abs_x = dx + tx
            abs_y = dy + ty
            table_positions[tid] = (abs_x, abs_y, tw, th)

            # Table header
            t_cell_id = cell_id
            table_cell_ids[tid] = t_cell_id
            cell_id += 1

            # Build column rows HTML
            col_rows = ""
            for cname, ctype, cflags in cols:
                prefix = ""
                if cflags == "PK":
                    prefix = "PK "
                elif cflags == "UL":
                    prefix = "ULID "
                elif cflags == "FK":
                    prefix = "FK "
                elif cflags == "UQ":
                    prefix = "UQ "
                col_rows += f'<tr><td align="left" style="padding:2px 6px;font-size:11px;">{prefix}{cname}</td><td align="right" style="padding:2px 6px;font-size:10px;color:#666;">{ctype}</td></tr>'

            label = (
                f'<table style="width:100%;font-size:12px;border-collapse:collapse;" cellpadding="0" cellspacing="0">'
                f'<tr><td colspan="2" style="padding:4px 6px;font-weight:bold;font-size:13px;'
                f'background:{DOMAINS[di]["stroke"]};color:#fff;border-radius:4px 4px 0 0;">{tname}</td></tr>'
                f'{col_rows}</table>'
            )

            cells.append(
                f'<mxCell id="{t_cell_id}" value="{xml_escape(label, {chr(34): "&quot;"})}" '
                f'style="shape=mxgraph.er.entity;whiteSpace=wrap;html=1;overflow=fill;fillColor=#ffffff;'
                f'strokeColor={DOMAINS[di]["stroke"]};rounded=1;shadow=1;fontSize=12;align=left;" '
                f'vertex="1" parent="{parent_id}">'
                f'<mxGeometry x="{tx}" y="{ty}" width="{tw}" height="{th}" as="geometry"/>'
                f'</mxCell>'
            )

    # ── Relationship arrows ────────────────────────────────────────────
    for src, tgt, card, on_del in RELS:
        if src not in table_cell_ids or tgt not in table_cell_ids:
            continue

        src_id = table_cell_ids[src]
        tgt_id = table_cell_ids[tgt]

        # Style based on relationship type
        if on_del == "APP":
            style = "endArrow=open;dashed=1;strokeColor=#999999;fontSize=9;"
        elif card == "1:1":
            style = "endArrow=diamond;endFill=1;strokeColor=#6c8ebf;fontSize=9;"
        else:
            style = "endArrow=ERmandOne;startArrow=ERmandOne;endFill=0;startFill=0;strokeColor=#666666;fontSize=9;"

        edge_id = cell_id
        cell_id += 1
        label_text = f"{card}"

        cells.append(
            f'<mxCell id="{edge_id}" value="{label_text}" '
            f'style="{style}html=1;exitX=0.5;exitY=1;exitDx=0;exitDy=0;curved=1;" '
            f'edge="1" parent="1" source="{src_id}" target="{tgt_id}">'
            f'<mxGeometry relative="1" as="geometry"/>'
            f'</mxCell>'
        )

    # Assemble
    xml = (
        '<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" '
        'tooltips="1" connect="1" arrows="1" fold="1" page="0" pageScale="1" '
        'pageWidth="5000" pageHeight="3000" math="0" shadow="0">'
        '<root>'
        '<mxCell id="0"/>'
        '<mxCell id="1" parent="0"/>'
        + "\n".join(cells) +
        '</root>'
        '</mxGraphModel>'
    )
    return xml


def build_drawio(xml):
    """Wrap mxGraph XML in the native .drawio format (XML with declaration)."""
    return f'<?xml version="1.0" encoding="UTF-8"?>\n{xml}'


def build_html(xml):
    """Wrap mxGraph XML in a draw.io viewer HTML page for browsers."""
    # The data-mxgraph attribute holds JSON with the XML embedded.
    # Chain: json.dumps() escapes " as \" in JSON → xml_escape() encodes &/</>/"
    # for the HTML attribute context → browser decodes HTML entities → draw.io JS
    # gets valid JSON → JSON.parse yields valid XML.
    json_data = json.dumps({
        "highlight": "#0000ff",
        "nav": True,
        "resize": True,
        "toolbar": "zoom layers tags lightbox",
        "edit": "_blank",
        "xml": xml
    })
    # HTML-escape so entities like &quot; in the XML survive browser HTML decoding
    escaped = xml_escape(json_data, {'"': "&quot;", "'": "&#39;"})

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Forge Platform — ERD (54 Tables, 15 Domains)</title>
<style>
  body {{ margin: 0; padding: 20px; background: #f5f5f5; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }}
  h1 {{ text-align: center; color: #333; margin-bottom: 5px; font-size: 22px; }}
  p.sub {{ text-align: center; color: #777; margin-top: 0; font-size: 13px; }}
  .diagram-container {{ background: #fff; border-radius: 8px; padding: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
  .legend {{ display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 15px 0; font-size: 12px; }}
  .legend-item {{ display: flex; align-items: center; gap: 4px; }}
  .legend-color {{ width: 14px; height: 14px; border-radius: 3px; border: 1px solid #ccc; }}
</style>
</head>
<body>
<h1>Forge Platform &mdash; Entity Relationship Diagram</h1>
<p class="sub">54 tables &middot; 15 domains &middot; ~600 columns &middot; PostgreSQL 15+</p>

<div class="legend">
  <span class="legend-item"><span class="legend-color" style="background:#dae8fc;"></span>Identity / Scheduling / Comm</span>
  <span class="legend-item"><span class="legend-color" style="background:#d5e8d4;"></span>PT / Logging / Form-Check</span>
  <span class="legend-item"><span class="legend-color" style="background:#fff2cc;"></span>Coaching / Nutrition / Notifications</span>
  <span class="legend-item"><span class="legend-color" style="background:#f8cecc;"></span>Gym / Billing / Gamification</span>
  <span class="legend-item"><span class="legend-color" style="background:#e1d5e7;"></span>Programming / AI / Marketplace</span>
  <span class="legend-item"><span style="border-bottom:2px dashed #999;width:20px;display:inline-block;"></span>App-enforced FK</span>
</div>

<div class="diagram-container">
  <div class="mxgraph" style="max-width:100%;" data-mxgraph="{escaped}"></div>
</div>

<script type="text/javascript" src="https://viewer.diagrams.net/js/viewer-static.min.js"></script>
</body>
</html>'''


if __name__ == "__main__":
    xml = build_xml()

    docs_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "docs")
    os.makedirs(docs_dir, exist_ok=True)

    # 1. Native .drawio file (open in draw.io desktop, fully editable)
    drawio_path = os.path.join(docs_dir, "Forge_ERD.drawio")
    drawio_content = build_drawio(xml)
    with open(drawio_path, "w", encoding="utf-8") as f:
        f.write(drawio_content)
    print(f"Generated: {drawio_path}")
    print(f"  File size: {len(drawio_content):,} bytes")

    # 2. HTML viewer (open in any browser, requires internet for draw.io JS)
    html_path = os.path.join(docs_dir, "Forge_ERD.drawio.html")
    html_content = build_html(xml)
    with open(html_path, "w", encoding="utf-8") as f:
        f.write(html_content)
    print(f"Generated: {html_path}")
    print(f"  File size: {len(html_content):,} bytes")

    print(f"\n  Tables: {len(TABLES)}")
    print(f"  Relationships: {len(RELS)}")
