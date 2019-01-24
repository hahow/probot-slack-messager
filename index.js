const get = require('lodash/get')
const findIndex = require('lodash/findIndex')
const SlackBot = require('slackbots')
// const createApp = require('probot/lib/github-app')
// const { findPrivateKey } = require('probot/lib/private-key')
const octokit = require('@octokit/rest')({
  debug: false
})

const colorOrange = '#fa8b00'

/** github <-> slack */
const _nameMapping = {
  'amowu': 'amowu',
  'austintodo': 'austin',
  'barry800414': 'weiming',
  'choznerol': 'lawrence',
  'citysite102': 'samuel',
  'henry40408': 'henry',
  'jason2506': 'jason.wu',
  'jiminycricket': 'jimmy',
  'miterfrants': 'peter',
  'raccoon-lee': 'raccoon',
  'rubychi ': 'rubychi',
  'tcchong': 'terrence',
  'weihanglo': 'weihanglo'
}

if (!process.env.REPORT_CHANNEl || !process.env.SLACK_BOT_TOKEN) {
  throw new Error('need REPORT_CHANNEl and SLACK_BOT_TOKEN')
}

const reportChannelName = process.env.REPORT_CHANNEl

const bot = new SlackBot({
  token: process.env.SLACK_BOT_TOKEN,
  name: process.env.SLACK_BOT_NAME || 'habug'
})

let contact = []
let reportChannelId

_getSlackUsers().then((contacts) => {
  contact = contacts
})

_getSlackChannel(reportChannelName).then((channel) => {
  reportChannelId = channel.id
})

// 主要有兩個大功能

// 1. probot 聽 github 的事件
module.exports = app => {
  app.log('probot-slack-messager is on!')

  octokit.authenticate({
    type: 'token',
    token: process.env.GITHUB_TOKEN
  })

  _onMoveIssue(app)
  _onIssueAssigned(app)
  _onIssueClosed(app)
  _onCommentIssue(app)
}

function _joinAssignees (assignees) {
  return assignees.map((assignee) => {
    return _appendMention(_transferUsernameToId([_nameMapping[assignee.login]]))
  }).join(', ')
}

function _parseColumn (columnUrl) {
  const components = columnUrl.split('/')
  const columnId = parseInt(components[components.length - 1])
  return isNaN(columnId) ? null : columnId
}

const issueUrlRegex = /https:\/\/github.com\/(.*)\/(.*)\/issues\/(.*)/
function _parseIssue (issueUrl) {
  const issuesMeta = issueUrl.match(issueUrlRegex)
  return {
    owner: issuesMeta[1],
    repo: issuesMeta[2],
    number: issuesMeta[3]
  }
}

/**
 * 在 project board 上移動 issues
 */
function _onMoveIssue () {
  app.on('project_card.moved', async context => {
    const issueUrl = get(context, 'payload.project_card.content_url')
    const issue = _parseIssue(issueUrl)
    const columnId = _parseColumn()
    if (!columnId || !issue) {
      return
    }
    const [issue, column] = await Promise.all([
      octokit.projects.getColumn({ column_id: columnId }),
      octokit.issues.get(issue)
    ])
    const issueTitle = issue.data.title
    const issueNumber = issue.data.number
    const issueAssignees = issue.data.assignees
    const issueBody = issue.data.body
    const issueUrl = issue.data.html_url
    const columnName = column.data.name

    // fond slack user in issue body
    const parseSlackUsername = _findSlackUsername(issueBody)
    if (parseSlackUsername.length < 1) return
    const slackIds = _transferUsernameToId(parseSlackUsername)
    const assignees = _joinAssignees(issueAssignees)
    const text = `${issueTitle} 從 ${columnName} 。${_appendMention(slackIds)}`
    _postSlackChannel(text, `#${issueNumber} ${issueTitle}`, issueUrl, assignees)
  })
}


function _onIssueClosed (app) {
  app.on('issues.closed', async context => {
    const issueUrl = get(context, 'payload.html_url')
    const issueBody = get(context, 'payload.issue.body')
    const issueNumber = get(context, 'payload.issue.number')
    const issueTitle = get(context, 'payload.issue.title')
    const issueAssignees = get(context, 'payload.issue.assignees')
    const issueLabels = get(context, 'payload.issue.labels')

    // fond slack user in issue body
    const parseSlackUsername = _findSlackUsername(issueBody)
    if (parseSlackUsername.length < 1) return

    const slackIds = _transferUsernameToId(parseSlackUsername)

    const isWontFix = findIndex(issueLabels, {
      name: 'wontfix'
    }) !== -1

    const assignees = _joinAssignees(issueAssignees)

    let text
    if (isWontFix) {
      text = `${issueTitle} 這個 issue 已經被 『關閉了』，想了解更多請詢問 ${assignees}。 ${_appendMention(slackIds)}`
    } else {
      text = `${issueTitle} 這個 issue 已經被 ${assignees} 修復了，等待上線後，這個問題就不見囉。 ${_appendMention(slackIds)}`
    }
    _postSlackChannel(text, `#${issueNumber} ${issueTitle}`, issueUrl, assignees)
  })
}

function _onCommentIssue (app) {
  app.on('issue_comment.created', async context => {
    // Issue
    const issueBody = get(context, 'payload.issue.body')
    const issueNumber = get(context, 'payload.issue.number')
    const issueTitle = get(context, 'payload.issue.title')
    const issueAssignees = get(context, 'payload.issue.assignees')

    // Comment
    const commentBody = get(context, 'payload.comment.body')
    const commentUrl = get(context, 'payload.comment.html_url')
    let commentUser = get(context, 'payload.comment.user.login')

    // fond slack user in issue body
    const parseSlackUsername = _findSlackUsername(issueBody)
    const slackIds = _transferUsernameToId(parseSlackUsername)
    const assignees = _joinAssignees(issueAssignees)

    // comment message
    const commentMessage = _findSlackMessage(commentBody)
    if (!commentMessage) {
      return
    }

    commentUser = _appendMention(_transferUsernameToId([_nameMapping[commentUser]]))
    const text = `Hi ${_appendMention(slackIds)}： ${commentUser} 在 ${issueTitle} 這個 issue 留言：${commentMessage} `

    _postSlackChannel(text, `#${issueNumber} ${issueTitle}`, commentUrl, assignees)
  })
}

function _onIssueAssigned (app) {
  app.on('issues.assigned', async context => {
    const issueUrl = get(context, 'payload.issue.html_url')
    const issueBody = get(context, 'payload.issue.body')
    const issueNumber = get(context, 'payload.issue.number')
    const issueTitle = get(context, 'payload.issue.title')
    const issueAssignees = get(context, 'payload.issue.assignees')

    // fond slack user in issue body
    const parseSlackUsername = _findSlackUsername(issueBody)
    if (parseSlackUsername.length < 1) return

    const slackIds = _transferUsernameToId(parseSlackUsername)

    const assignees = _joinAssignees(issueAssignees)
    const text = `Hi ${_appendMention(slackIds)}, ${issueTitle} 這個 issue 被指派給 ${assignees}，想了解後續進度就去找他（們）。`
    _postSlackChannel(text, `#${issueNumber} ${issueTitle}`, issueUrl, assignees)
  })
}

function _postSlackChannel (text, issueTitle, issueUrl, assignees) {
  bot.postMessage(reportChannelId,
    text,
    {
      attachments: [
        {
          title: issueTitle,
          title_link: issueUrl,
          color: colorOrange
        }
      ]
    }
  )
}

function _findSlackMessage (body) {
  const regex1 = /\/slack/gm
  const matches = body.match(regex1) || []
  if (matches.length > 0) {
    return body.replace(/\/slack/g, '')
  }
  return false
}

function _appendMention (ids) {
  const slackNotifyPrefix = '<@'
  const slackNotifyPostfix = '>'

  return ids.map((id) => {
    return `${slackNotifyPrefix}${id}${slackNotifyPostfix}`
  }).join(' ')
}

function _transferUsernameToId (names = []) {
  let result = []
  names.map((name) => {
    return contact.filter((member) => {
      return member.names.includes(name)
    }).map((member) => {
      return member.id
    }).forEach((memberIds) => {
      result = result.concat(memberIds)
    })
  })
  return result
}

function _findSlackUsername (body) {
  let usernames = []
  const regex1 = /<slack([a-zA-z\s1-9]*)>([a-zA-z\s0-9,]*)<\/slack>/gm
  const regex2 = /<slack([a-zA-z\s1-9]*)>([a-zA-z\s0-9,]*)<\/slack>/

  const matches = body.match(regex1) || []

  if (matches.length > 0) {
    matches.forEach((match) => {
      usernames = usernames.concat(match.match(regex2)[2].split(', '))
    })
  }
  return usernames
}

function _getSlackUsers () {
  return bot.getUsers().then((res) => {
    return res.members.filter((member) => {
      return !member.is_bot && member.deleted === false
    }).map((member) => {
      const names = []
      if (member.name) {
        names.push(member.name)
      }

      if (get(member, 'profile.real_name')) {
        names.push(get(member, 'profile.real_name'))
      }

      if (get(member, 'profile.display_name')) {
        names.push(get(member, 'profile.display_name'))
      }

      return {
        id: member.id,
        names
      }
    })
  })
}

function _getSlackChannel (name) {
  return bot.getChannel(name)
}
