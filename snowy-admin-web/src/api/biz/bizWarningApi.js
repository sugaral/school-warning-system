import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/warning/' + url, ...arg)

export default {
	warningPage(data) {
		return request('page', data, 'get')
	},
	warningDetail(data) {
		return request('detail', data, 'get')
	},
	warningAcknowledge(data) {
		return request('acknowledge', data)
	},
	warningClose(data) {
		return request('close', data)
	},
	warningDelete(data) {
		return request('delete', data)
	},
	warningRescan(data) {
		return request('rescan', data || {})
	},
	casePage(data) {
		return request('case/page', data, 'get')
	},
	caseDetail(data) {
		return request('case/detail', data, 'get')
	},
	caseAssign(data) {
		return request('case/assign', data)
	},
	caseAccept(data) {
		return request('case/accept', data)
	},
	caseComplete(data) {
		return request('case/complete', data)
	},
	caseResolve(data) {
		return request('case/resolve', data)
	},
	weeklySummary(data) {
		return request('summary/weekly', data, 'get')
	},
	monthlySummary(data) {
		return request('summary/monthly', data, 'get')
	},
	termSummary(data) {
		return request('summary/term', data, 'get')
	},
	rebuildSummary(data) {
		return request('summary/rebuild', data || {})
	},
	studentSnapshots(data) {
		return request('snapshot/students', data, 'get')
	},
	classSnapshots(data) {
		return request('snapshot/classes', data, 'get')
	}
}
