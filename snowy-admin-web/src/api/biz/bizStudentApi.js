import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/student/' + url, ...arg)

export default {
	studentPage(data) {
		return request('page', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	studentDelete(data) {
		return request('delete', data)
	},
	studentDetail(data) {
		return request('detail', data, 'get')
	},
	studentResetPassword(data) {
		return request('resetPassword', data)
	},
	studentUnbindWechat(data) {
		return request('unbindWechat', data)
	},
	studentExportAccounts(data) {
		return request('exportAccounts', data, 'get', { responseType: 'blob' })
	},
	studentImportTemplate() {
		return request('importTemplate', {}, 'get', { responseType: 'blob' })
	},
	studentImport(formData, dryRun = false) {
		return request(`import?dryRun=${dryRun}`, formData, 'post', {
			headers: { 'Content-Type': 'multipart/form-data' }
		})
	},
	orgTreeSelector(data) {
		return request('orgTreeSelector', data, 'get')
	}
}
