import { baseRequest } from '@/utils/request'

const request = (url, ...arg) => baseRequest('/biz/schedule/' + url, ...arg)

export default {
	schedulePage(data) {
		return request('page', data, 'get')
	},
	submitForm(data, edit = false) {
		return request(edit ? 'edit' : 'add', data)
	},
	scheduleDelete(data) {
		return request('delete', data)
	},
	scheduleDetail(data) {
		return request('detail', data, 'get')
	},
	scheduleImportTemplate() {
		return request('importTemplate', {}, 'get', { responseType: 'blob' })
	},
	scheduleImport(formData, dryRun = false) {
		return request(`import?dryRun=${dryRun}`, formData, 'post', {
			headers: { 'Content-Type': 'multipart/form-data' }
		})
	}
}
