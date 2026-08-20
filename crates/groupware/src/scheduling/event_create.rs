/*
 * SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
 *
 * SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
 */

use crate::scheduling::{
    Email, ItipError, ItipMessage, attendee::attendee_handle_update, itip::itip_finalize,
    organizer::organizer_request_full, snapshot::itip_snapshot,
};
use calcard::icalendar::{
    ICalendar, ICalendarParameter, ICalendarParameterName, ICalendarParameterValue,
    ICalendarParticipationStatus, ICalendarProperty,
};

pub fn itip_create(
    ical: &mut ICalendar,
    account_emails: &[String],
) -> Result<Vec<ItipMessage<ICalendar>>, ItipError> {
    let itip = itip_snapshot(ical, account_emails, false)?;
    if !itip.organizer.is_server_scheduling {
        Err(ItipError::OtherSchedulingAgent)
    } else if !itip.organizer.email.is_local {
        Err(ItipError::NotOrganizer)
    } else {
        let mut sequences = Vec::new();
        organizer_request_full(ical, &itip, Some(&mut sequences), true).inspect(|_| {
            itip_finalize(ical, &sequences);
        })
    }
}

pub fn itip_create_or_reply(
    ical: &mut ICalendar,
    account_emails: &[String],
) -> Result<Vec<ItipMessage<ICalendar>>, ItipError> {
    match itip_create(ical, account_emails) {
        Err(ItipError::NotOrganizer | ItipError::OtherSchedulingAgent) => {
            itip_attendee_reply(ical, account_emails)
        }
        other => other,
    }
}

pub fn itip_create_or_update(
    ical: &mut ICalendar,
    previous: &ICalendar,
    account_emails: &[String],
) -> Result<Vec<ItipMessage<ICalendar>>, ItipError> {
    match itip_create(ical, account_emails) {
        Err(ItipError::NotOrganizer | ItipError::OtherSchedulingAgent) => {
            itip_attendee_update(ical, previous, account_emails)
        }
        other => other,
    }
}

fn itip_attendee_reply(
    ical: &mut ICalendar,
    account_emails: &[String],
) -> Result<Vec<ItipMessage<ICalendar>>, ItipError> {
    let mut previous = ical.clone();
    reset_local_attendee_partstat(&mut previous, account_emails);
    itip_attendee_update(ical, &previous, account_emails)
}

fn itip_attendee_update(
    ical: &mut ICalendar,
    previous: &ICalendar,
    account_emails: &[String],
) -> Result<Vec<ItipMessage<ICalendar>>, ItipError> {
    let old_itip = itip_snapshot(previous, account_emails, true)?;
    let new_itip = itip_snapshot(ical, account_emails, true)?;
    attendee_handle_update(ical, old_itip, new_itip)
}

fn reset_local_attendee_partstat(ical: &mut ICalendar, account_emails: &[String]) {
    for component in &mut ical.components {
        if !component.component_type.is_scheduling_object() {
            continue;
        }
        for entry in &mut component.entries {
            if !matches!(entry.name, ICalendarProperty::Attendee) {
                continue;
            }
            let Some(email) = entry.values.first().and_then(|value| value.as_text()) else {
                continue;
            };
            if !Email::new(email, account_emails).is_some_and(|parsed| parsed.is_local) {
                continue;
            }
            if let Some(param) = entry
                .params
                .iter_mut()
                .find(|param| matches!(param.name, ICalendarParameterName::Partstat))
            {
                param.value =
                    ICalendarParameterValue::Partstat(ICalendarParticipationStatus::NeedsAction);
            } else {
                entry.params.push(ICalendarParameter::partstat(
                    ICalendarParticipationStatus::NeedsAction,
                ));
            }
        }
    }
}
